const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * POST /api/pos/checkout
 * Body: { location_id?, customer_id?, items: [{ product_id, quantity, location_id? }] }
 * Each line may include location_id; otherwise body.location_id is used as the default.
 * Lines are grouped by resolved location: one completed invoice per distinct location.
 */
router.post("/checkout", async (req, res) => {
  const defaultLocationRaw = req.body?.location_id;
  const defaultLocationId = parseInt(defaultLocationRaw, 10);
  const hasDefaultLocation = Number.isInteger(defaultLocationId) && defaultLocationId >= 1;

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
    if (customerId !== null) {
      const custChk = await client.query("SELECT 1 FROM customers WHERE id = $1", [
        customerId,
      ]);
      if (!custChk.rowCount) {
        return res.status(400).json({ error: "Customer not found" });
      }
    }

    const pricedLines = [];
    for (const line of items) {
      const productId = parseInt(line?.product_id, 10);
      const qty = Number(line?.quantity);
      if (!Number.isInteger(productId) || productId < 1) {
        return res.status(400).json({ error: "Each item needs a valid product_id" });
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: "Each item needs quantity greater than zero" });
      }

      let lineLocationId = null;
      const rawLoc = line?.location_id;
      if (rawLoc !== undefined && rawLoc !== null && rawLoc !== "") {
        const loc = parseInt(rawLoc, 10);
        if (!Number.isInteger(loc) || loc < 1) {
          return res.status(400).json({ error: "Each item needs a valid location_id when provided" });
        }
        lineLocationId = loc;
      } else if (hasDefaultLocation) {
        lineLocationId = defaultLocationId;
      } else {
        return res.status(400).json({
          error: "location_id is required on the sale or on each line item",
        });
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
      pricedLines.push({ productId, qty, unitPrice, lineTotal, locationId: lineLocationId });
    }

    const locationIds = [...new Set(pricedLines.map((L) => L.locationId))];
    for (const locId of locationIds) {
      const locChk = await client.query(
        "SELECT 1 FROM location WHERE id = $1 AND COALESCE(is_active, true) = true",
        [locId]
      );
      if (!locChk.rowCount) {
        return res.status(400).json({ error: "Invalid or inactive location" });
      }
    }

    const byLocation = new Map();
    for (const L of pricedLines) {
      if (!byLocation.has(L.locationId)) {
        byLocation.set(L.locationId, []);
      }
      byLocation.get(L.locationId).push(L);
    }

    await client.query("BEGIN");

    const invoices = [];
    let invIndex = 0;
    for (const [locId, groupLines] of byLocation) {
      const invoiceTotal = roundMoney(groupLines.reduce((s, L) => s + L.lineTotal, 0));
      const invoiceNumber = `POS-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${invIndex++}`;

      const { rows: invRows } = await client.query(
        `INSERT INTO invoices (invoice_number, customer_id, location_id, total, status)
         VALUES ($1, $2, $3, $4, 'completed')
         RETURNING id, invoice_number, customer_id, location_id, total, status, created_at`,
        [invoiceNumber, customerId, locId, invoiceTotal]
      );
      const invoice = invRows[0];

      const savedItems = [];
      for (const L of groupLines) {
        const { rows: itemRows } = await client.query(
          `INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, total)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, product_id, quantity, unit_price, total`,
          [invoice.id, L.productId, L.qty, L.unitPrice, L.lineTotal]
        );
        savedItems.push(itemRows[0]);
      }
      invoices.push({ invoice, items: savedItems });
    }

    await client.query("COMMIT");
    res.status(201).json({ invoices });
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
