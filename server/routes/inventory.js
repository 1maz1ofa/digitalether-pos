const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");
const {
  resolveLocationAccess,
  sendLocationForbidden,
  enforceLocationAccess,
} = require("../utils/userLocationScope");

const router = express.Router();

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

function parseOptionalNumber(val) {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/** List movement types. */
router.get("/movement-types", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, description, is_positive, created_at
       FROM movement_type
       ORDER BY code ASC, id ASC`
    );
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.get("/movement-types/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const { rows } = await pool.query(
      `SELECT id, code, name, description, is_positive, created_at
       FROM movement_type
       WHERE id = $1`,
      [id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Movement type not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.post("/movement-types", async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim();
    const name = String(req.body?.name || "").trim();
    const description =
      req.body?.description === undefined || req.body?.description === null
        ? null
        : String(req.body.description).trim() || null;
    let is_positive = null;
    if (req.body?.is_positive !== undefined && req.body?.is_positive !== null) {
      is_positive = Boolean(req.body.is_positive);
    }

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO movement_type (code, name, description, is_positive)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, name, description, is_positive, created_at`,
      [code, name, description, is_positive]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.put("/movement-types/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const code = String(req.body?.code || "").trim();
    const name = String(req.body?.name || "").trim();
    const description =
      req.body?.description === undefined || req.body?.description === null
        ? null
        : String(req.body.description).trim() || null;
    let is_positive = null;
    if (req.body?.is_positive !== undefined && req.body?.is_positive !== null) {
      is_positive = Boolean(req.body.is_positive);
    }

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const { rows } = await pool.query(
      `UPDATE movement_type
       SET code = $1, name = $2, description = $3, is_positive = $4
       WHERE id = $5
       RETURNING id, code, name, description, is_positive, created_at`,
      [code, name, description, is_positive, id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Movement type not found" });
    }
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.delete("/movement-types/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const { rowCount } = await pool.query("DELETE FROM movement_type WHERE id = $1", [id]);
    if (!rowCount) {
      return res.status(404).json({ error: "Movement type not found" });
    }
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

/** On-hand balances with product and location labels. */
router.get("/stock", async (req, res) => {
  try {
    const access = resolveLocationAccess(req.user, req.query?.location_id);
    if (!access.ok) return sendLocationForbidden(res, access.error);
    const locationId =
      access.locationId !== null ? access.locationId : parseOptionalInt(req.query?.location_id);
    const productId = parseOptionalInt(req.query?.product_id);
    const params = [];
    const filters = [];
    if (locationId !== null) {
      params.push(locationId);
      filters.push(`i.location_id = $${params.length}`);
    }
    if (productId !== null) {
      params.push(productId);
      filters.push(`i.product_id = $${params.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT i.id, i.product_id, i.location_id, i.quantity, i.updated_at,
              p.code AS product_code, p.name AS product_name,
              l.code AS location_code, l.name AS location_name
       FROM inventory i
       LEFT JOIN product p ON p.id = i.product_id
       LEFT JOIN location l ON l.id = i.location_id
       ${where}
       ORDER BY l.name NULLS LAST, p.name NULLS LAST, i.id`,
      params
    );
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

/**
 * Per-product on-hand totals across all locations, plus promise aggregates.
 * Includes products with no inventory rows (total = 0) so the catalog is fully visible.
 */
router.get("/stock/summary", async (req, res) => {
  try {
    const access = resolveLocationAccess(req.user, req.query?.location_id);
    if (!access.ok) return sendLocationForbidden(res, access.error);
    const locationId =
      access.locationId !== null ? access.locationId : parseOptionalInt(req.query?.location_id);

    const params = [];
    let inventoryJoin = "LEFT JOIN inventory i ON i.product_id = p.id";
    if (locationId !== null) {
      params.push(locationId);
      inventoryJoin = `LEFT JOIN inventory i ON i.product_id = p.id AND i.location_id = $${params.length}`;
    }

    const promiseJoin =
      locationId !== null
        ? `LEFT JOIN (
         SELECT product_id,
                SUM(COALESCE(reserved_quantity, 0)) FILTER (WHERE from_location_id = $1)::numeric AS sum_reserved,
                SUM(COALESCE(promised_quantity, 0)) FILTER (WHERE from_location_id = $1)::numeric AS sum_out_promised,
                SUM(COALESCE(promised_quantity, 0)) FILTER (WHERE to_location_id = $1)::numeric AS sum_in_promised
         FROM inventory_promise
         GROUP BY product_id
       ) pr ON pr.product_id = p.id`
        : `LEFT JOIN (
         SELECT product_id,
                SUM(COALESCE(reserved_quantity, 0))::numeric AS sum_reserved,
                SUM(COALESCE(promised_quantity, 0))::numeric AS sum_out_promised,
                SUM(COALESCE(promised_quantity, 0))::numeric AS sum_in_promised
         FROM inventory_promise
         GROUP BY product_id
       ) pr ON pr.product_id = p.id`;

    const { rows } = await pool.query(
      `SELECT p.id AS product_id,
              p.code AS product_code,
              p.name AS product_name,
              p.unit_of_measure,
              p.is_active,
              COALESCE(SUM(i.quantity), 0)::numeric AS total_quantity,
              COALESCE(SUM(i.quantity), 0)::numeric AS stock_on_hand,
              COUNT(i.id) FILTER (WHERE i.quantity IS NOT NULL AND COALESCE(i.quantity, 0) <> 0) AS location_count,
              COALESCE(pr.sum_reserved, 0)::numeric AS reserved_quantity,
              COALESCE(pr.sum_out_promised, 0)::numeric AS out_promised_quantity,
              COALESCE(pr.sum_in_promised, 0)::numeric AS in_promised_quantity
       FROM product p
       ${inventoryJoin}
       ${promiseJoin}
       GROUP BY p.id, p.code, p.name, p.unit_of_measure, p.is_active,
                pr.sum_reserved, pr.sum_out_promised, pr.sum_in_promised
       ORDER BY p.name NULLS LAST, p.code NULLS LAST, p.id`,
      params
    );
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

/** Recent ledger lines (newest first). */
router.get("/movements", async (req, res) => {
  try {
    let limit = parseInt(req.query?.limit, 10);
    if (!Number.isInteger(limit) || limit < 1) limit = 100;
    if (limit > 2000) limit = 2000;
    const access = resolveLocationAccess(req.user, req.query?.location_id);
    if (!access.ok) return sendLocationForbidden(res, access.error);
    const locationId =
      access.locationId !== null ? access.locationId : parseOptionalInt(req.query?.location_id);
    const params = [limit];
    const locationFilter =
      locationId !== null ? `WHERE im.location_id = $2` : "";
    if (locationId !== null) params.push(locationId);
    const { rows } = await pool.query(
      `SELECT im.id, im.product_id, im.location_id, im.quantity, im.unit_cost, im.total_cost,
              im.movement_type_id, im.reference_type, im.reference_id, im.notes,
              im.created_at, im.created_by,
              p.code AS product_code, p.name AS product_name,
              l.code AS location_code, l.name AS location_name,
              mt.code AS movement_type_code, mt.name AS movement_type_name
       FROM inventory_movement im
       LEFT JOIN product p ON p.id = im.product_id
       LEFT JOIN location l ON l.id = im.location_id
       LEFT JOIN movement_type mt ON mt.id = im.movement_type_id
       ${locationFilter}
       ORDER BY im.id DESC
       LIMIT $1`,
      params
    );
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

/**
 * Record a movement and apply the same signed quantity to inventory (upsert by product + location).
 * quantity must be non-zero (DB check); positive increases stock, negative decreases.
 */
router.post("/movements", async (req, res) => {
  const productId = parseInt(req.body?.product_id, 10);
  const locationId = parseInt(req.body?.location_id, 10);
  const movementTypeId = parseInt(req.body?.movement_type_id, 10);
  const quantity = Number(req.body?.quantity);

  if (!Number.isInteger(productId) || productId < 1) {
    return res.status(400).json({ error: "product_id is required" });
  }
  if (!Number.isInteger(locationId) || locationId < 1) {
    return res.status(400).json({ error: "location_id is required" });
  }
  if (!enforceLocationAccess(req.user, locationId, res)) {
    return;
  }
  if (!Number.isInteger(movementTypeId) || movementTypeId < 1) {
    return res.status(400).json({ error: "movement_type_id is required" });
  }
  if (!Number.isFinite(quantity) || quantity === 0) {
    return res.status(400).json({
      error: "quantity must be a non-zero number (positive to add stock, negative to remove)",
    });
  }

  const unitCost = parseOptionalNumber(req.body?.unit_cost);
  const referenceType = safeText(req.body?.reference_type);
  const referenceId = parseOptionalInt(req.body?.reference_id);
  const notes = safeText(req.body?.notes);
  const createdBy = safeText(req.body?.created_by);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productChk = await client.query("SELECT 1 FROM product WHERE id = $1", [productId]);
    if (!productChk.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Product not found" });
    }
    const locChk = await client.query(
      "SELECT 1 FROM location WHERE id = $1 AND COALESCE(is_active, true) = true",
      [locationId]
    );
    if (!locChk.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Location not found or inactive" });
    }
    const typeChk = await client.query("SELECT 1 FROM movement_type WHERE id = $1", [
      movementTypeId,
    ]);
    if (!typeChk.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "movement_type_id is invalid" });
    }

    const insertMov = await client.query(
      `INSERT INTO inventory_movement (
        product_id, location_id, quantity, unit_cost, movement_type_id,
        reference_type, reference_id, notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, product_id, location_id, quantity, unit_cost, total_cost,
                movement_type_id, reference_type, reference_id, notes, created_at, created_by`,
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

    const invRes = await client.query(
      `INSERT INTO inventory (product_id, location_id, quantity, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (product_id, location_id)
       DO UPDATE SET
         quantity = inventory.quantity + EXCLUDED.quantity,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, product_id, location_id, quantity, updated_at`,
      [productId, locationId, quantity]
    );

    await client.query("COMMIT");
    res.status(201).json({
      movement: insertMov.rows[0],
      inventory: invRes.rows[0],
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

module.exports = router;
