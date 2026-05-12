const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

function parseRequiredPositiveInt(val) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parsePromisedQuantity(val) {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** List promises, optionally filtered by from_location_id and/or product_id. */
router.get("/", async (req, res) => {
  try {
    const fromLocationId = parseRequiredPositiveInt(req.query?.from_location_id);
    const productId = parseRequiredPositiveInt(req.query?.product_id);
    const params = [];
    const clauses = [];
    if (fromLocationId !== null) {
      params.push(fromLocationId);
      clauses.push(`ip.from_location_id = $${params.length}`);
    }
    if (productId !== null) {
      params.push(productId);
      clauses.push(`ip.product_id = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT ip.id,
              ip.product_id,
              ip.from_location_id,
              ip.to_location_id,
              ip.promised_quantity,
              ip.reserved_quantity,
              ip.created_at,
              p.code AS product_code,
              p.name AS product_name,
              fl.code AS from_location_code,
              fl.name AS from_location_name,
              tl.code AS to_location_code,
              tl.name AS to_location_name
       FROM inventory_promise ip
       LEFT JOIN product p ON p.id = ip.product_id
       LEFT JOIN location fl ON fl.id = ip.from_location_id
       LEFT JOIN location tl ON tl.id = ip.to_location_id
       ${where}
       ORDER BY ip.created_at DESC, ip.id DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

/**
 * Create a promise: reserve a quantity from from_location toward to_location.
 * promised_quantity cannot exceed on-hand at from_location minus existing commitments
 * from that location for the product (each row counts promised_quantity + reserved_quantity;
 * reserved_quantity grows when the destination POS consumes the promise).
 */
router.post("/", async (req, res) => {
  const fromLocationId = parseRequiredPositiveInt(req.body?.from_location_id);
  const toLocationId = parseRequiredPositiveInt(req.body?.to_location_id);
  const productId = parseRequiredPositiveInt(req.body?.product_id);
  const promisedQty = parsePromisedQuantity(req.body?.promised_quantity);

  if (fromLocationId === null) {
    return res.status(400).json({ error: "from_location_id is required" });
  }
  if (toLocationId === null) {
    return res.status(400).json({ error: "to_location_id is required" });
  }
  if (fromLocationId === toLocationId) {
    return res.status(400).json({ error: "to_location_id must differ from from_location_id" });
  }
  if (productId === null) {
    return res.status(400).json({ error: "product_id is required" });
  }
  if (promisedQty === null) {
    return res.status(400).json({ error: "promised_quantity must be a number greater than zero" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const productChk = await client.query(
      "SELECT 1 FROM product WHERE id = $1 AND COALESCE(is_active, true) = true",
      [productId]
    );
    if (!productChk.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Product not found or inactive" });
    }

    const fromLoc = await client.query(
      "SELECT 1 FROM location WHERE id = $1 AND COALESCE(is_active, true) = true",
      [fromLocationId]
    );
    if (!fromLoc.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "From location not found or inactive" });
    }

    const toLoc = await client.query(
      "SELECT 1 FROM location WHERE id = $1 AND COALESCE(is_active, true) = true",
      [toLocationId]
    );
    if (!toLoc.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "To location not found or inactive" });
    }

    const inv = await client.query(
      `SELECT quantity
       FROM inventory
       WHERE product_id = $1 AND location_id = $2
       FOR UPDATE`,
      [productId, fromLocationId]
    );
    const onHand = inv.rows[0]?.quantity != null ? Number(inv.rows[0].quantity) : 0;

    const sumProm = await client.query(
      `SELECT COALESCE(SUM(COALESCE(promised_quantity, 0) + COALESCE(reserved_quantity, 0)), 0)::numeric AS s
       FROM inventory_promise
       WHERE product_id = $1 AND from_location_id = $2`,
      [productId, fromLocationId]
    );
    const alreadyCommitted = Number(sumProm.rows[0].s);
    const available = onHand - alreadyCommitted;

    if (promisedQty > available) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Not enough available quantity at this location for this product",
        detail: `Available to promise: ${available} (on hand: ${onHand}, already committed via promises: ${alreadyCommitted})`,
      });
    }

    const insert = await client.query(
      `INSERT INTO inventory_promise (product_id, from_location_id, to_location_id, promised_quantity)
       VALUES ($1, $2, $3, $4)
       RETURNING id, product_id, from_location_id, to_location_id, promised_quantity, reserved_quantity, created_at`,
      [productId, fromLocationId, toLocationId, promisedQty]
    );

    await client.query("COMMIT");
    res.status(201).json(insert.rows[0]);
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
