const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");
const {
  getUserLocationId,
  enforceLocationAccess,
} = require("../utils/userLocationScope");
const { requireTableAccess } = require("../middleware/requireTableAccess");

const router = express.Router();
router.use(requireTableAccess("reserve_issue_header"));

function reserveHeaderFilterSql(userLoc, paramIndex) {
  if (userLoc == null) return "";
  return ` AND EXISTS (
    SELECT 1
    FROM reserve_issue_items ri
    JOIN inventory_promise ip ON ip.id = ri.promise_id
    WHERE ri.header_id = h.id AND ip.from_location_id = $${paramIndex}
  )`;
}

function safeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function parsePositiveInt(value) {
  if (value === undefined || value === null) return null;
  const n = parseInt(String(value).trim(), 10);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

async function ensureReserveOutMovementTypeId(client) {
  const { rows } = await client.query(
    `SELECT id FROM movement_type
     WHERE LOWER(TRIM(COALESCE(code, ''))) = 'reserveout'
     ORDER BY id ASC
     LIMIT 1`
  );
  if (rows.length) return Number(rows[0].id);
  try {
    const ins = await client.query(
      `INSERT INTO movement_type (code, name, description, is_positive)
       VALUES ('RESERVEOUT', 'Reserve issue', 'Ship reserved promise stock from source location (decreases on-hand)', false)
       RETURNING id`
    );
    return Number(ins.rows[0].id);
  } catch (err) {
    if (err && err.code === "23505") {
      const again = await client.query(
        `SELECT id FROM movement_type
         WHERE LOWER(TRIM(COALESCE(code, ''))) = 'reserveout'
         LIMIT 1`
      );
      if (again.rows.length) return Number(again.rows[0].id);
    }
    throw err;
  }
}

const RESERVE_ISSUE_ITEMS_SQL = `
  SELECT ri.id,
         ri.product_id,
         ri.promise_id,
         ri.quantity,
         ri.unit_cost,
         ri.total_cost,
         p.code AS product_code,
         p.name AS product_name,
         ip.from_location_id,
         fl.code AS from_location_code,
         fl.name AS from_location_name
  FROM reserve_issue_items ri
  JOIN inventory_promise ip ON ip.id = ri.promise_id
  LEFT JOIN product p ON p.id = ri.product_id
  LEFT JOIN location fl ON fl.id = ip.from_location_id
  WHERE ri.header_id = $1
  ORDER BY ri.id ASC`;

/**
 * GET /api/inventory/reserve-issues
 *   — all pending queues: { pending: [ { header, items } ] }
 * GET /api/inventory/reserve-issues?header_id=N
 *   — one queue by header id: { header, items }
 * GET /api/inventory/reserve-issues?invoice_number=...
 *   — every pending queue for that invoice (one per ship-from store): { queues: [ { header, items }, ... ] }
 */
router.get("/", async (req, res) => {
  try {
    const headerId = parsePositiveInt(req.query?.header_id);
    const invoiceNumber = safeText(req.query?.invoice_number);

    if (headerId) {
      const userLoc = getUserLocationId(req.user);
      const params = [headerId];
      const locFilter = reserveHeaderFilterSql(userLoc, 2);
      if (userLoc != null) params.push(userLoc);
      const { rows: headers } = await pool.query(
        `SELECT h.id, h.location_id, h.total_products, h.invoice_number, h.created_at,
                loc.name AS location_name, loc.code AS location_code
         FROM reserve_issue_header h
         LEFT JOIN location loc ON loc.id = h.location_id
         WHERE h.id = $1${locFilter}`,
        params
      );
      if (!headers.length) {
        return res.json({ header: null, items: [] });
      }
      const header = headers[0];
      const { rows: items } = await pool.query(RESERVE_ISSUE_ITEMS_SQL, [header.id]);
      return res.json({ header, items });
    }

    if (invoiceNumber) {
      const userLoc = getUserLocationId(req.user);
      const params = [invoiceNumber];
      const locFilter = reserveHeaderFilterSql(userLoc, 2);
      if (userLoc != null) params.push(userLoc);
      const { rows: headers } = await pool.query(
        `SELECT h.id, h.location_id, h.total_products, h.invoice_number, h.created_at,
                loc.name AS location_name, loc.code AS location_code
         FROM reserve_issue_header h
         LEFT JOIN location loc ON loc.id = h.location_id
         WHERE h.invoice_number = $1${locFilter}
         ORDER BY h.id ASC`,
        params
      );
      if (!headers.length) {
        return res.json({ queues: [], header: null, items: [] });
      }
      const ids = headers.map((h) => Number(h.id));
      const { rows: itemRows } = await pool.query(
        `SELECT ri.header_id,
                ri.id,
                ri.product_id,
                ri.promise_id,
                ri.quantity,
                ri.unit_cost,
                ri.total_cost,
                p.code AS product_code,
                p.name AS product_name,
                ip.from_location_id,
                fl.code AS from_location_code,
                fl.name AS from_location_name
         FROM reserve_issue_items ri
         JOIN inventory_promise ip ON ip.id = ri.promise_id
         LEFT JOIN product p ON p.id = ri.product_id
         LEFT JOIN location fl ON fl.id = ip.from_location_id
         WHERE ri.header_id = ANY($1::int[])
         ORDER BY ri.header_id ASC, ri.id ASC`,
        [ids]
      );
      const itemsByHeader = new Map();
      for (const row of itemRows) {
        const hid = Number(row.header_id);
        const { header_id: _hid, ...item } = row;
        if (!itemsByHeader.has(hid)) itemsByHeader.set(hid, []);
        itemsByHeader.get(hid).push(item);
      }
      const queues = headers.map((h) => ({
        header: h,
        items: itemsByHeader.get(Number(h.id)) || [],
      }));
      const sole = queues.length === 1 ? queues[0] : null;
      return res.json({
        queues,
        header: sole ? sole.header : null,
        items: sole ? sole.items : [],
      });
    }

    const userLoc = getUserLocationId(req.user);
    const params = [];
    const locFilter = reserveHeaderFilterSql(userLoc, 1);
    if (userLoc != null) params.push(userLoc);
    const { rows: headers } = await pool.query(
      `SELECT h.id, h.location_id, h.total_products, h.invoice_number, h.created_at,
              loc.name AS location_name, loc.code AS location_code
       FROM reserve_issue_header h
       LEFT JOIN location loc ON loc.id = h.location_id
       WHERE 1=1${locFilter}
       ORDER BY h.created_at DESC NULLS LAST, h.id DESC`,
      params
    );
    if (!headers.length) {
      return res.json({ pending: [] });
    }
    const ids = headers.map((h) => Number(h.id));
    const { rows: itemRows } = await pool.query(
      `SELECT ri.header_id,
              ri.id,
              ri.product_id,
              ri.promise_id,
              ri.quantity,
              ri.unit_cost,
              ri.total_cost,
              p.code AS product_code,
              p.name AS product_name,
              ip.from_location_id,
              fl.code AS from_location_code,
              fl.name AS from_location_name
       FROM reserve_issue_items ri
       JOIN inventory_promise ip ON ip.id = ri.promise_id
       LEFT JOIN product p ON p.id = ri.product_id
       LEFT JOIN location fl ON fl.id = ip.from_location_id
       WHERE ri.header_id = ANY($1::int[])
       ORDER BY ri.header_id ASC, ri.id ASC`,
      [ids]
    );
    const itemsByHeader = new Map();
    for (const row of itemRows) {
      const hid = Number(row.header_id);
      const { header_id: _hid, ...item } = row;
      if (!itemsByHeader.has(hid)) itemsByHeader.set(hid, []);
      itemsByHeader.get(hid).push(item);
    }
    const pending = headers.map((h) => ({
      header: h,
      items: itemsByHeader.get(Number(h.id)) || [],
    }));
    return res.json({ pending });
  } catch (err) {
    sendPgError(res, err);
  }
});

/**
 * POST /api/inventory/reserve-issues/issue
 * Body: { invoice_number?: string, header_id?: number }
 * Prefer header_id when both are sent so the queue row matches the UI selection.
 * Clears reserve_issue rows, reduces promise reserved_quantity, deducts inventory at from_location, posts RESERVEOUT movements.
 */
router.post("/issue", async (req, res) => {
  const headerIdBody = parsePositiveInt(req.body?.header_id);
  const invoiceNumber = safeText(req.body?.invoice_number);
  if (!headerIdBody && !invoiceNumber) {
    return res.status(400).json({ error: "invoice_number or header_id is required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let header;
    if (headerIdBody) {
      const { rows: headers } = await client.query(
        `SELECT id, location_id, invoice_number
         FROM reserve_issue_header
         WHERE id = $1
         FOR UPDATE`,
        [headerIdBody]
      );
      if (!headers.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          error: "No pending reserve issue for this header_id",
        });
      }
      header = headers[0];
    } else {
      const { rows: headers } = await client.query(
        `SELECT id, location_id, invoice_number
         FROM reserve_issue_header
         WHERE invoice_number = $1
         ORDER BY id ASC
         FOR UPDATE`,
        [invoiceNumber]
      );
      if (!headers.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          error: "No pending reserve issue for this invoice_number",
        });
      }
      if (headers.length > 1) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error:
            "Several reserve issue queues exist for this invoice (one per ship-from store). " +
            "Issue each queue separately using header_id.",
          header_ids: headers.map((h) => Number(h.id)),
        });
      }
      header = headers[0];
    }

    const headerId = Number(header.id);
    const invoiceLabel = safeText(header.invoice_number) || `header ${headerId}`;

    const { rows: items } = await client.query(
      `SELECT ri.id,
              ri.product_id,
              ri.promise_id,
              ri.quantity,
              ri.unit_cost
       FROM reserve_issue_items ri
       WHERE ri.header_id = $1
       ORDER BY ri.id ASC
       FOR UPDATE`,
      [headerId]
    );
    if (!items.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Reserve issue header has no lines" });
    }

    const { rows: shipFromRows } = await client.query(
      `SELECT ip.from_location_id
       FROM reserve_issue_items ri
       JOIN inventory_promise ip ON ip.id = ri.promise_id
       WHERE ri.header_id = $1`,
      [headerId]
    );
    const shipFromSet = new Set();
    for (const r of shipFromRows) {
      const id = Number(r.from_location_id);
      if (!Number.isInteger(id) || id <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error:
            "One or more reserve lines are missing a valid promise ship-from location (from_location_id).",
        });
      }
      shipFromSet.add(id);
    }
    if (shipFromSet.size !== 1) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error:
          "This reserve queue mixes multiple ship-from stores; split queues at checkout or re-create lines. " +
          "One issue may only deduct inventory at a single source location.",
      });
    }

    const shipFromLocationId = [...shipFromSet][0];
    if (!enforceLocationAccess(req.user, shipFromLocationId, res)) {
      await client.query("ROLLBACK");
      return;
    }

    const movementTypeId = await ensureReserveOutMovementTypeId(client);
    const movements = [];
    const issueNumber = String(headerId);
    const consumedPromiseIds = [];

    for (const row of items) {
      const itemId = Number(row.id);
      const productId = Number(row.product_id);
      const promiseId = Number(row.promise_id);
      const qty = Number(row.quantity);
      const unitCost =
        row.unit_cost != null && Number.isFinite(Number(row.unit_cost))
          ? Number(row.unit_cost)
          : null;
      if (!Number.isInteger(itemId) || !Number.isInteger(productId) || !Number.isInteger(promiseId)) {
        throw new Error("Invalid reserve_issue_items row");
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("Invalid quantity on reserve_issue_items");
      }

      const prom = await client.query(
        `SELECT id, product_id, from_location_id,
                COALESCE(reserved_quantity, 0)::numeric AS reserved_quantity
         FROM inventory_promise
         WHERE id = $1
         FOR UPDATE`,
        [promiseId]
      );
      if (!prom.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `inventory_promise ${promiseId} no longer exists; cannot issue reserve line ${itemId}`,
        });
      }
      const pRow = prom.rows[0];
      if (Number(pRow.product_id) !== productId) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "reserve_issue_items.product_id does not match promise",
        });
      }
      const fromLocationId = Number(pRow.from_location_id);
      const reserved = Number(pRow.reserved_quantity);
      if (!Number.isFinite(reserved) || reserved + 1e-9 < qty) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `Insufficient reserved_quantity on promise ${promiseId} (have ${reserved}, need ${qty})`,
        });
      }

      await client.query(
        `UPDATE inventory_promise
         SET reserved_quantity = GREATEST(COALESCE(reserved_quantity, 0) - $1, 0)
         WHERE id = $2`,
        [qty, promiseId]
      );

      const inv = await client.query(
        `SELECT id, COALESCE(quantity, 0)::numeric AS quantity
         FROM inventory
         WHERE product_id = $1 AND location_id = $2
         FOR UPDATE`,
        [productId, fromLocationId]
      );
      if (!inv.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `No inventory row at promising location ${fromLocationId} for product ${productId}`,
        });
      }
      const onHand = Number(inv.rows[0].quantity);
      if (!Number.isFinite(onHand) || onHand + 1e-9 < qty) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `Not enough on-hand at promising location ${fromLocationId} for product ${productId} (have ${onHand}, need ${qty})`,
        });
      }

      const saleQty = -Math.abs(qty);
      const movIns = await client.query(
        `INSERT INTO inventory_movement (
           product_id, location_id, quantity, unit_cost, movement_type_id,
           reference_type, reference_id, notes, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          productId,
          fromLocationId,
          saleQty,
          unitCost,
          movementTypeId,
          "reserve_issue_item",
          itemId,
          `RESERVEOUT invoice ${invoiceLabel}`,
          null,
        ]
      );

      await client.query(
        `UPDATE inventory
         SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [saleQty, Number(inv.rows[0].id)]
      );

      movements.push({
        reserve_issue_item_id: itemId,
        inventory_movement_id: Number(movIns.rows[0].id),
      });
      consumedPromiseIds.push(promiseId);
    }

    const distinctPromiseIds = [...new Set(consumedPromiseIds)];
    if (distinctPromiseIds.length > 0) {
      await client.query(
        `UPDATE inventory_promise
         SET issue_number = $1
         WHERE id = ANY($2::int[])`,
        [issueNumber, distinctPromiseIds]
      );
    }

    await client.query(`DELETE FROM reserve_issue_header WHERE id = $1`, [headerId]);

    await client.query("COMMIT");
    res.json({
      ok: true,
      invoice_number: safeText(header.invoice_number),
      header_id: headerId,
      issue_number: issueNumber,
      movements_posted: movements.length,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    sendPgError(res, err);
  } finally {
    client.release();
  }
});

module.exports = router;
