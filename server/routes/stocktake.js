const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

const HEADER_STATUSES = ["DRAFT", "IN_PROGRESS", "COMPLETED", "APPROVED", "CANCELLED"];

function safeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function parseOptionalInt(val) {
  if (val === undefined || val === null || val === "") return null;
  const n = parseInt(val, 10);
  return Number.isInteger(n) ? n : null;
}

function parseNumber(val, fallback = 0) {
  if (val === undefined || val === null || val === "") return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

function computeDetailFields(productCost, systemCount, actualCount) {
  const cost = parseNumber(productCost, 0);
  const sys = parseNumber(systemCount, 0);
  const act = parseNumber(actualCount, 0);
  const system_value = roundMoney(sys * cost);
  const actual_value = roundMoney(act * cost);
  const variance_count = roundMoney(act - sys);
  const variance_value = roundMoney(actual_value - system_value);
  return {
    product_cost: cost,
    system_count: sys,
    actual_count: act,
    system_value,
    actual_value,
    variance_count,
    variance_value,
  };
}

async function recalcHeaderTotals(client, stocktakeId) {
  await client.query(
    `UPDATE stocktake_header h
     SET total_items = sub.cnt,
         total_system_value = sub.sys_val,
         total_counted_value = sub.act_val,
         total_variance_value = sub.var_val,
         updated_at = CURRENT_TIMESTAMP
     FROM (
       SELECT COUNT(*)::int AS cnt,
              COALESCE(SUM(system_value), 0)::numeric AS sys_val,
              COALESCE(SUM(actual_value), 0)::numeric AS act_val,
              COALESCE(SUM(variance_value), 0)::numeric AS var_val
       FROM stocktake_detail
       WHERE stocktake_id = $1
     ) sub
     WHERE h.id = $1`,
    [stocktakeId]
  );
}

const headerSelect = `
  SELECT h.id, h.description, h.stocktake_date, h.status,
         h.total_items, h.total_counted_value, h.total_system_value, h.total_variance_value,
         h.location_id, h.reference_number, h.created_by, h.created_at,
         h.updated_by, h.updated_at, h.approved_by, h.approved_at, h.comments,
         l.code AS location_code, l.name AS location_name
  FROM stocktake_header h
  LEFT JOIN location l ON l.id = h.location_id
`;

const detailSelect = `
  SELECT d.id, d.stocktake_id, d.product_id, d.product_cost,
         d.system_count, d.system_value, d.actual_count, d.actual_value,
         d.variance_count, d.variance_value,
         d.created_by, d.created_at, d.updated_by, d.updated_at, d.comments,
         p.code AS product_code, p.name AS product_name, p.unit_of_measure
  FROM stocktake_detail d
  LEFT JOIN product p ON p.id = d.product_id
`;

async function fetchStocktakeBundle(id) {
  const headerRes = await pool.query(`${headerSelect} WHERE h.id = $1`, [id]);
  if (!headerRes.rows.length) return null;
  const detailsRes = await pool.query(
    `${detailSelect} WHERE d.stocktake_id = $1 ORDER BY p.name NULLS LAST, p.code NULLS LAST, d.id`,
    [id]
  );
  return { header: headerRes.rows[0], details: detailsRes.rows };
}

function normalizeStatus(status) {
  const s = String(status || "DRAFT").trim().toUpperCase();
  return HEADER_STATUSES.includes(s) ? s : "DRAFT";
}

function parseDateOnly(val) {
  const s = String(val || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

async function ensureMovementTypeId(client, code, name, description, isPositive) {
  const key = String(code || "").trim().toLowerCase();
  const { rows } = await client.query(
    `SELECT id FROM movement_type
     WHERE LOWER(TRIM(COALESCE(code, ''))) = $1
     ORDER BY id ASC
     LIMIT 1`,
    [key]
  );
  if (rows.length) return Number(rows[0].id);
  try {
    const ins = await client.query(
      `INSERT INTO movement_type (code, name, description, is_positive)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [code, name, description, isPositive]
    );
    return Number(ins.rows[0].id);
  } catch (err) {
    if (err && err.code === "23505") {
      const again = await client.query(
        `SELECT id FROM movement_type
         WHERE LOWER(TRIM(COALESCE(code, ''))) = $1
         LIMIT 1`,
        [key]
      );
      if (again.rows.length) return Number(again.rows[0].id);
    }
    throw err;
  }
}

async function recordInventoryMovement(client, {
  productId,
  locationId,
  quantity,
  unitCost,
  movementTypeId,
  referenceType,
  referenceId,
  notes,
  createdBy,
}) {
  const movIns = await client.query(
    `INSERT INTO inventory_movement (
       product_id, location_id, quantity, unit_cost, movement_type_id,
       reference_type, reference_id, notes, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      productId,
      locationId,
      quantity,
      unitCost,
      movementTypeId,
      referenceType,
      referenceId,
      notes,
      createdBy,
    ]
  );

  await client.query(
    `INSERT INTO inventory (product_id, location_id, quantity, updated_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (product_id, location_id)
     DO UPDATE SET
       quantity = inventory.quantity + EXCLUDED.quantity,
       updated_at = CURRENT_TIMESTAMP`,
    [productId, locationId, quantity]
  );

  return Number(movIns.rows[0].id);
}

/** List stock take headers. */
router.get("/", async (req, res) => {
  try {
    const locationId = parseOptionalInt(req.query?.location_id);
    const status = safeText(req.query?.status);
    const params = [];
    const filters = [];
    if (locationId !== null && locationId > 0) {
      params.push(locationId);
      filters.push(`h.location_id = $${params.length}`);
    }
    if (status) {
      params.push(status.toUpperCase());
      filters.push(`UPPER(h.status) = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `${headerSelect} ${where}
       ORDER BY h.stocktake_date DESC, h.id DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

/** Get one stock take with detail lines. */
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const bundle = await fetchStocktakeBundle(id);
    if (!bundle) return res.status(404).json({ error: "Stock take not found" });
    res.json(bundle);
  } catch (err) {
    sendPgError(res, err);
  }
});

/** Create stock take header. */
router.post("/", async (req, res) => {
  try {
    const description = safeText(req.body?.description);
    const stocktakeDate = parseDateOnly(req.body?.stocktake_date);
    const locationId = parseOptionalInt(req.body?.location_id);
    const referenceNumber = safeText(req.body?.reference_number);
    const status = normalizeStatus(req.body?.status);
    const comments = safeText(req.body?.comments);
    const createdBy = safeText(req.body?.created_by);

    if (!description) {
      return res.status(400).json({ error: "description is required" });
    }
    if (!stocktakeDate) {
      return res.status(400).json({ error: "stocktake_date is required (YYYY-MM-DD)" });
    }
    if (locationId === null || locationId < 1) {
      return res.status(400).json({ error: "location_id is required" });
    }

    const locChk = await pool.query("SELECT 1 FROM location WHERE id = $1", [locationId]);
    if (!locChk.rowCount) {
      return res.status(400).json({ error: "Location not found" });
    }

    const { rows } = await pool.query(
      `INSERT INTO stocktake_header (
         description, stocktake_date, status, location_id,
         reference_number, comments, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [description, stocktakeDate, status, locationId, referenceNumber, comments, createdBy]
    );
    const bundle = await fetchStocktakeBundle(rows[0].id);
    res.status(201).json(bundle);
  } catch (err) {
    sendPgError(res, err);
  }
});

/** Update stock take header (not detail lines). */
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const existing = await pool.query(
      "SELECT id, location_id, status FROM stocktake_header WHERE id = $1",
      [id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: "Stock take not found" });
    }

    const description = safeText(req.body?.description);
    const stocktakeDate = parseDateOnly(req.body?.stocktake_date);
    const locationId = parseOptionalInt(req.body?.location_id);
    const referenceNumber = safeText(req.body?.reference_number);
    const status =
      req.body?.status !== undefined ? normalizeStatus(req.body.status) : null;
    const comments =
      req.body?.comments !== undefined ? safeText(req.body.comments) : undefined;
    const updatedBy = safeText(req.body?.updated_by);
    const approvedBy = safeText(req.body?.approved_by);

    if (description === null && req.body?.description !== undefined) {
      return res.status(400).json({ error: "description cannot be empty" });
    }
    if (req.body?.stocktake_date !== undefined && !stocktakeDate) {
      return res.status(400).json({ error: "stocktake_date must be YYYY-MM-DD" });
    }

    const currentStatus = String(existing.rows[0].status || "").trim().toUpperCase();

    if (status === "APPROVED" && currentStatus !== "APPROVED") {
      return res.status(400).json({
        error: "Use Confirm stock take to approve and post stock adjustments",
      });
    }
    if (currentStatus === "APPROVED" && status && status !== "APPROVED") {
      return res.status(400).json({ error: "Cannot change status of a confirmed stock take" });
    }

    if (locationId !== null && locationId !== existing.rows[0].location_id) {
      const detailChk = await pool.query(
        "SELECT 1 FROM stocktake_detail WHERE stocktake_id = $1 LIMIT 1",
        [id]
      );
      if (detailChk.rowCount) {
        return res.status(400).json({
          error: "Cannot change location while detail lines exist. Remove lines first.",
        });
      }
      const locChk = await pool.query("SELECT 1 FROM location WHERE id = $1", [locationId]);
      if (!locChk.rowCount) {
        return res.status(400).json({ error: "Location not found" });
      }
    }

    const sets = [];
    const params = [];
    function add(field, value) {
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    }

    if (description !== null) add("description", description);
    if (stocktakeDate) add("stocktake_date", stocktakeDate);
    if (locationId !== null && locationId > 0) add("location_id", locationId);
    if (req.body?.reference_number !== undefined) add("reference_number", referenceNumber);
    if (status) add("status", status);
    if (comments !== undefined) add("comments", comments);
    if (updatedBy !== null) add("updated_by", updatedBy);
    add("updated_at", new Date());

    if (req.body?.approved_by !== undefined) {
      add("approved_by", approvedBy);
      add("approved_at", approvedBy ? new Date() : null);
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(id);
    await pool.query(
      `UPDATE stocktake_header SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params
    );

    const bundle = await fetchStocktakeBundle(id);
    res.json(bundle);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const { rowCount } = await pool.query("DELETE FROM stocktake_header WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Stock take not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

/**
 * Add detail lines from on-hand inventory at the stock take location.
 * Skips products already on this stock take.
 */
router.post("/:id/populate-from-stock", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const includeZero =
    req.body?.include_zero === true || String(req.query?.include_zero) === "1";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hdr = await client.query(
      "SELECT id, location_id FROM stocktake_header WHERE id = $1 FOR UPDATE",
      [id]
    );
    if (!hdr.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Stock take not found" });
    }
    const locationId = hdr.rows[0].location_id;
    const createdBy = safeText(req.body?.created_by);

    const stockFilter = includeZero ? "" : "AND COALESCE(i.quantity, 0) <> 0";

    const insertRes = await client.query(
      `INSERT INTO stocktake_detail (
         stocktake_id, product_id, product_cost,
         system_count, system_value, actual_count, actual_value,
         variance_count, variance_value, created_by
       )
       SELECT $1, p.id, COALESCE(p.unit_cost, 0)::numeric,
              COALESCE(i.quantity, 0)::numeric,
              round((COALESCE(i.quantity, 0) * COALESCE(p.unit_cost, 0))::numeric, 2),
              0, 0,
              round((0 - COALESCE(i.quantity, 0))::numeric, 2),
              round((0 - (COALESCE(i.quantity, 0) * COALESCE(p.unit_cost, 0)))::numeric, 2),
              $3
       FROM product p
       LEFT JOIN inventory i
         ON i.product_id = p.id AND i.location_id = $2
       WHERE COALESCE(p.is_active, true) = true
         ${stockFilter}
         AND NOT EXISTS (
           SELECT 1 FROM stocktake_detail sd
           WHERE sd.stocktake_id = $1 AND sd.product_id = p.id
         )
       RETURNING id`,
      [id, locationId, createdBy]
    );

    await recalcHeaderTotals(client, id);
    await client.query("COMMIT");

    const bundle = await fetchStocktakeBundle(id);
    res.json({
      inserted: insertRes.rowCount,
      ...bundle,
    });
  } catch (txErr) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    sendPgError(res, txErr);
  } finally {
    client.release();
  }
});

/** Add a detail line. */
router.post("/:id/details", async (req, res) => {
  const stocktakeId = Number(req.params.id);
  if (!Number.isInteger(stocktakeId) || stocktakeId < 1) {
    return res.status(400).json({ error: "Invalid stock take id" });
  }

  const productId = parseOptionalInt(req.body?.product_id);
  if (productId === null || productId < 1) {
    return res.status(400).json({ error: "product_id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hdr = await client.query(
      "SELECT id FROM stocktake_header WHERE id = $1",
      [stocktakeId]
    );
    if (!hdr.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Stock take not found" });
    }

    const prod = await client.query(
      "SELECT id, unit_cost FROM product WHERE id = $1",
      [productId]
    );
    if (!prod.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Product not found" });
    }

    let systemCount = parseNumber(req.body?.system_count, NaN);
    if (!Number.isFinite(systemCount)) {
      const inv = await client.query(
        `SELECT COALESCE(quantity, 0)::numeric AS quantity
         FROM inventory i
         INNER JOIN stocktake_header h ON h.id = $1 AND i.location_id = h.location_id
         WHERE i.product_id = $2`,
        [stocktakeId, productId]
      );
      systemCount = inv.rows.length ? parseNumber(inv.rows[0].quantity, 0) : 0;
    }

    const productCost =
      req.body?.product_cost !== undefined && req.body?.product_cost !== null
        ? parseNumber(req.body.product_cost, 0)
        : parseNumber(prod.rows[0].unit_cost, 0);

    const actualCount =
      req.body?.actual_count !== undefined
        ? parseNumber(req.body.actual_count, 0)
        : systemCount;

    const fields = computeDetailFields(productCost, systemCount, actualCount);
    const comments = safeText(req.body?.comments);
    const createdBy = safeText(req.body?.created_by);

    const insertRes = await client.query(
      `INSERT INTO stocktake_detail (
         stocktake_id, product_id, product_cost,
         system_count, system_value, actual_count, actual_value,
         variance_count, variance_value, comments, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        stocktakeId,
        productId,
        fields.product_cost,
        fields.system_count,
        fields.system_value,
        fields.actual_count,
        fields.actual_value,
        fields.variance_count,
        fields.variance_value,
        comments,
        createdBy,
      ]
    );

    await recalcHeaderTotals(client, stocktakeId);
    await client.query("COMMIT");

    const line = await pool.query(
      `${detailSelect} WHERE d.id = $1`,
      [insertRes.rows[0].id]
    );
    res.status(201).json(line.rows[0]);
  } catch (txErr) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    sendPgError(res, txErr);
  } finally {
    client.release();
  }
});

/** Update a detail line (typically actual count). */
router.put("/:id/details/:detailId", async (req, res) => {
  const stocktakeId = Number(req.params.id);
  const detailId = Number(req.params.detailId);
  if (!Number.isInteger(stocktakeId) || stocktakeId < 1) {
    return res.status(400).json({ error: "Invalid stock take id" });
  }
  if (!Number.isInteger(detailId) || detailId < 1) {
    return res.status(400).json({ error: "Invalid detail id" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cur = await client.query(
      `SELECT id, product_cost, system_count, actual_count
       FROM stocktake_detail
       WHERE id = $1 AND stocktake_id = $2`,
      [detailId, stocktakeId]
    );
    if (!cur.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Detail line not found" });
    }

    const row = cur.rows[0];
    const productCost =
      req.body?.product_cost !== undefined
        ? parseNumber(req.body.product_cost, 0)
        : parseNumber(row.product_cost, 0);
    const systemCount =
      req.body?.system_count !== undefined
        ? parseNumber(req.body.system_count, 0)
        : parseNumber(row.system_count, 0);
    const actualCount =
      req.body?.actual_count !== undefined
        ? parseNumber(req.body.actual_count, 0)
        : parseNumber(row.actual_count, 0);

    const fields = computeDetailFields(productCost, systemCount, actualCount);
    const comments =
      req.body?.comments !== undefined ? safeText(req.body.comments) : undefined;
    const updatedBy = safeText(req.body?.updated_by);

    const sets = [
      "product_cost = $1",
      "system_count = $2",
      "system_value = $3",
      "actual_count = $4",
      "actual_value = $5",
      "variance_count = $6",
      "variance_value = $7",
      "updated_at = CURRENT_TIMESTAMP",
    ];
    const params = [
      fields.product_cost,
      fields.system_count,
      fields.system_value,
      fields.actual_count,
      fields.actual_value,
      fields.variance_count,
      fields.variance_value,
    ];
    if (comments !== undefined) {
      params.push(comments);
      sets.push(`comments = $${params.length}`);
    }
    if (updatedBy !== null) {
      params.push(updatedBy);
      sets.push(`updated_by = $${params.length}`);
    }
    params.push(detailId, stocktakeId);

    await client.query(
      `UPDATE stocktake_detail SET ${sets.join(", ")}
       WHERE id = $${params.length - 1} AND stocktake_id = $${params.length}`,
      params
    );

    await recalcHeaderTotals(client, stocktakeId);
    await client.query("COMMIT");

    const line = await pool.query(`${detailSelect} WHERE d.id = $1`, [detailId]);
    res.json(line.rows[0]);
  } catch (txErr) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    sendPgError(res, txErr);
  } finally {
    client.release();
  }
});

/**
 * Confirm a completed stock take: create STOCKADJIN / STOCKADJOUT movements
 * from line variances and set status to APPROVED.
 */
router.post("/:id/confirm", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const approvedBy = safeText(req.body?.approved_by);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hdr = await client.query(
      `SELECT id, location_id, status, reference_number, description
       FROM stocktake_header
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    if (!hdr.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Stock take not found" });
    }

    const header = hdr.rows[0];
    const status = String(header.status || "").trim().toUpperCase();

    if (status === "APPROVED") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Stock take is already confirmed (approved)" });
    }
    if (status === "CANCELLED") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Cannot confirm a cancelled stock take" });
    }
    if (status !== "COMPLETED" && status !== "DRAFT" && status !== "IN_PROGRESS") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Stock take cannot be confirmed in its current status",
      });
    }

    const dupMov = await client.query(
      `SELECT 1 FROM inventory_movement
       WHERE reference_type = 'stocktake' AND reference_id = $1
       LIMIT 1`,
      [id]
    );
    if (dupMov.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Stock adjustments were already posted for this stock take",
      });
    }

    const detailsRes = await client.query(
      `SELECT id, product_id, product_cost, variance_count
       FROM stocktake_detail
       WHERE stocktake_id = $1
       ORDER BY id`,
      [id]
    );
    if (!detailsRes.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Stock take has no count lines to confirm" });
    }

    const stockAdjInTypeId = await ensureMovementTypeId(
      client,
      "STOCKADJIN",
      "Stock adjustment in",
      "Stock take count increase (variance up)",
      true
    );
    const stockAdjOutTypeId = await ensureMovementTypeId(
      client,
      "STOCKADJOUT",
      "Stock adjustment out",
      "Stock take count decrease (variance down)",
      false
    );

    const locationId = Number(header.location_id);
    const refLabel =
      safeText(header.reference_number) ||
      safeText(header.description) ||
      `#${id}`;
    const createdBy = approvedBy;
    const movements = [];

    for (const line of detailsRes.rows) {
      const variance = parseNumber(line.variance_count, 0);
      if (variance === 0) continue;

      const productId = Number(line.product_id);
      if (!Number.isInteger(productId) || productId < 1) continue;

      const unitCost = parseNumber(line.product_cost, 0);
      const movementTypeId = variance > 0 ? stockAdjInTypeId : stockAdjOutTypeId;
      const typeCode = variance > 0 ? "STOCKADJIN" : "STOCKADJOUT";

      const movementId = await recordInventoryMovement(client, {
        productId,
        locationId,
        quantity: variance,
        unitCost,
        movementTypeId,
        referenceType: "stocktake",
        referenceId: id,
        notes: `${typeCode} stock take ${refLabel} (line ${line.id})`,
        createdBy,
      });

      movements.push({
        detail_id: Number(line.id),
        product_id: productId,
        variance_count: variance,
        movement_type_code: typeCode,
        inventory_movement_id: movementId,
      });
    }

    await client.query(
      `UPDATE stocktake_header
       SET status = 'APPROVED',
           approved_by = $1,
           approved_at = CURRENT_TIMESTAMP,
           updated_by = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [approvedBy, id]
    );

    await client.query("COMMIT");

    const bundle = await fetchStocktakeBundle(id);
    res.json({
      movements_created: movements.length,
      movements,
      ...bundle,
    });
  } catch (txErr) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    sendPgError(res, txErr);
  } finally {
    client.release();
  }
});

router.delete("/:id/details/:detailId", async (req, res) => {
  const stocktakeId = Number(req.params.id);
  const detailId = Number(req.params.detailId);
  if (!Number.isInteger(stocktakeId) || stocktakeId < 1) {
    return res.status(400).json({ error: "Invalid stock take id" });
  }
  if (!Number.isInteger(detailId) || detailId < 1) {
    return res.status(400).json({ error: "Invalid detail id" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      "DELETE FROM stocktake_detail WHERE id = $1 AND stocktake_id = $2",
      [detailId, stocktakeId]
    );
    if (!rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Detail line not found" });
    }
    await recalcHeaderTotals(client, stocktakeId);
    await client.query("COMMIT");
    res.status(204).send();
  } catch (txErr) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    sendPgError(res, txErr);
  } finally {
    client.release();
  }
});

module.exports = router;
