const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Integer location id from BRANCH_ID or branch_id in .env; null if unset or invalid. */
function defaultLocationIdFromEnv() {
  const raw = process.env.BRANCH_ID ?? process.env.branch_id;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const id = parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(id) || id < 1) return null;
  return id;
}

/** Optional display label for the POS branch (header, receipts); not required for checkout. */
function branchDisplayNameFromEnv() {
  const raw = process.env.BRANCH_NAME ?? process.env.D365_BRANCH_NAME;
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

router.get("/settings", (req, res) => {
  res.json({
    defaultLocationId: defaultLocationIdFromEnv(),
    branchName: branchDisplayNameFromEnv(),
  });
});

/**
 * POST /api/pos/checkout
 * Body: { location_id?, customer_id?, items: [{ product_id, quantity, location_id? }],
 *   optional HTB / D365: d365_credit_application_id?, d365_customer_guid?, d365_minimum_deposit? (ignored until persisted) }
 * Each line may include location_id; otherwise body.location_id or BRANCH_ID/branch_id env is used as the default.
 * Lines are grouped by resolved location: one completed invoice per distinct location.
 */
router.post("/checkout", async (req, res) => {
  const defaultLocationRaw = req.body?.location_id;
  let resolvedDefaultLocationId = null;
  if (defaultLocationRaw !== undefined && defaultLocationRaw !== null && defaultLocationRaw !== "") {
    const parsed = parseInt(defaultLocationRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return res.status(400).json({ error: "Invalid location_id" });
    }
    resolvedDefaultLocationId = parsed;
  } else {
    resolvedDefaultLocationId = defaultLocationIdFromEnv();
  }
  const hasDefaultLocation =
    resolvedDefaultLocationId != null &&
    Number.isInteger(resolvedDefaultLocationId) &&
    resolvedDefaultLocationId >= 1;

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
        lineLocationId = resolvedDefaultLocationId;
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
