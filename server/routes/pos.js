const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * POST /api/pos/checkout
 * Body: { location_id, customer_id? (optional), items: [{ product_id, quantity }] }
 * Creates an invoice and line items using current product unit prices from the database.
 */
router.post("/checkout", async (req, res) => {
  const locationId = parseInt(req.body?.location_id, 10);
  if (!Number.isInteger(locationId) || locationId < 1) {
    return res.status(400).json({ error: "location_id is required" });
  }

  let customerId = null;
  const rawCustomer = req.body?.customer_id;
  if (rawCustomer !== undefined && rawCustomer !== null && rawCustomer !== "") {
    const c = parseInt(rawCustomer, 10);
    if (!Number.isInteger(c) || c < 1) {
      return res.status(400).json({ error: "Invalid customer_id" });
    }
    customerId = c;
  }

  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items must be a non-empty array" });
  }

  const client = await pool.connect();
  try {
    const locChk = await client.query(
      "SELECT 1 FROM location WHERE id = $1 AND COALESCE(is_active, true) = true",
      [locationId]
    );
    if (!locChk.rowCount) {
      return res.status(400).json({ error: "Invalid or inactive location" });
    }

    if (customerId !== null) {
      const custChk = await client.query("SELECT 1 FROM customers WHERE id = $1", [
        customerId,
      ]);
      if (!custChk.rowCount) {
        return res.status(400).json({ error: "Customer not found" });
      }
    }

    const lines = [];
    for (const line of items) {
      const productId = parseInt(line?.product_id, 10);
      const qty = Number(line?.quantity);
      if (!Number.isInteger(productId) || productId < 1) {
        return res.status(400).json({ error: "Each item needs a valid product_id" });
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: "Each item needs quantity greater than zero" });
      }
      const { rows } = await client.query(
        `SELECT id, unit_price, is_active FROM product WHERE id = $1`,
        [productId]
      );
      if (!rows.length) {
        return res.status(400).json({ error: `Product ${productId} not found` });
      }
      const p = rows[0];
      if (!p.is_active) {
        return res.status(400).json({ error: `Product ${productId} is not active` });
      }
      const unitPrice = p.unit_price != null ? Number(p.unit_price) : null;
      if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(400).json({
          error: `Product ${productId} has no valid unit price`,
        });
      }
      const lineTotal = roundMoney(qty * unitPrice);
      lines.push({ productId, qty, unitPrice, lineTotal });
    }

    const invoiceTotal = roundMoney(lines.reduce((s, L) => s + L.lineTotal, 0));
    const invoiceNumber = `POS-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    await client.query("BEGIN");

    const { rows: invRows } = await client.query(
      `INSERT INTO invoices (invoice_number, customer_id, location_id, total, status)
       VALUES ($1, $2, $3, $4, 'completed')
       RETURNING id, invoice_number, customer_id, location_id, total, status, created_at`,
      [invoiceNumber, customerId, locationId, invoiceTotal]
    );
    const invoice = invRows[0];

    const savedItems = [];
    for (const L of lines) {
      const { rows: itemRows } = await client.query(
        `INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, total)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, product_id, quantity, unit_price, total`,
        [invoice.id, L.productId, L.qty, L.unitPrice, L.lineTotal]
      );
      savedItems.push(itemRows[0]);
    }

    await client.query("COMMIT");
    res.status(201).json({ invoice, items: savedItems });
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
