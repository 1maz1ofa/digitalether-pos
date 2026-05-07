const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");
const {
  d365Configured,
  d365ConfigError,
  getFinalApprovedCreditApplicationById,
} = require("../services/d365Client");

const router = express.Router();

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function moneyToCents(n) {
  return Math.round(Number(n) * 100);
}

function safeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function readHtbMaxDepositPercent() {
  const raw = process.env.HTB_MAX_DEPOSIT_PERCENT;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return 50;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 100) {
    return null;
  }
  return Math.round(parsed * 100) / 100;
}

function branchGuidFromEnv() {
  const raw =
    process.env.D365_BRANCH_ID ??
    process.env.d365_branch_id ??
    process.env.BRANCH_ID ??
    process.env.branch_id;
  if (raw === undefined || raw === null) return null;
  const guid = String(raw).trim().toLowerCase();
  if (guid === "") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guid)) {
    return null;
  }
  return guid;
}

async function defaultLocationFromEnv(client, { requireActive = false } = {}) {
  const guid = branchGuidFromEnv();
  if (!guid) return null;
  const where = requireActive
    ? "d365_id::text = $1 AND COALESCE(is_active, true) = true"
    : "d365_id::text = $1";
  const { rows } = await client.query(
    `SELECT id, name, code
     FROM location
     WHERE ${where}
     ORDER BY id ASC
     LIMIT 1`,
    [guid]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    name: row.name ? String(row.name).trim() : null,
    code: row.code ? String(row.code).trim() : null,
  };
}

function buildLocalHtbCustomerName(record) {
  const first = record?.customerFirstName ? String(record.customerFirstName).trim() : "";
  const last = record?.customerLastName ? String(record.customerLastName).trim() : "";
  const joined = `${first} ${last}`.trim();
  if (joined) return joined;
  const guid = record?.customer365Guid ? String(record.customer365Guid).trim() : "";
  if (guid) return `HTB Customer ${guid.slice(0, 8)}`;
  return "HTB Customer";
}

function isDuplicateHtbCreditApplicationError(err) {
  if (!err || err.code !== "23505") return false;
  const constraint = String(err.constraint || "").toLowerCase();
  const detail = String(err.detail || "").toLowerCase();
  return (
    constraint.includes("creditapplication_id") ||
    detail.includes("creditapplication_id") ||
    detail.includes("(creditapplication_id)")
  );
}

router.get("/settings", async (req, res) => {
  try {
    const fromEnv = await defaultLocationFromEnv(pool);
    const htbMaxDepositPercent = readHtbMaxDepositPercent();
    if (htbMaxDepositPercent === null) {
      return res.status(500).json({
        error: "HTB_MAX_DEPOSIT_PERCENT must be a number greater than 0 and less than 100.",
      });
    }
    res.json({
      defaultLocationId: fromEnv?.id ?? null,
      branchName: fromEnv?.name || fromEnv?.code || null,
      htbMaxDepositPercent,
    });
  } catch (err) {
    sendPgError(res, err);
  }
});

router.get("/payment-methods", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name
       FROM payment_methods
       WHERE COALESCE(is_active, true) = true
       ORDER BY name ASC, id ASC`
    );
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

/**
 * POST /api/pos/checkout
 * Body: { location_id?, customer_id?, items: [{ product_id, quantity, location_id? }],
 *   optional HTB / D365: d365_credit_application_id?, d365_customer_guid?, d365_minimum_deposit? }
 * Each line may include location_id; otherwise body.location_id or branch_id (D365 GUID in .env) is mapped to a local
 * location by location.d365_id and used as the default.
 * Lines are grouped by resolved location: one completed invoice per distinct location.
 */
router.post("/checkout", async (req, res) => {
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

  const saleType = req.body?.sale_type;
  if (saleType === "htb") {
    const d365AppId = req.body?.d365_credit_application_id;
    if (d365AppId === undefined || d365AppId === null || String(d365AppId).trim() === "") {
      return res.status(400).json({
        error: "HTB checkout requires a selected credit application (customer).",
      });
    }
    if (!d365Configured()) {
      return res.status(503).json({ error: d365ConfigError() });
    }
  }

  const rawPayment = req.body?.payment;
  const rawPayments = req.body?.payments;
  let normalizedPayments = [];
  if (Array.isArray(rawPayments)) {
    normalizedPayments = rawPayments;
  } else if (rawPayment && typeof rawPayment === "object" && !Array.isArray(rawPayment)) {
    normalizedPayments = [rawPayment];
  }
  const parsedPayments = [];
  for (let idx = 0; idx < normalizedPayments.length; idx += 1) {
    const payment = normalizedPayments[idx];
    const parsedMethod = parseInt(payment?.payment_method_id, 10);
    if (!Number.isInteger(parsedMethod) || parsedMethod < 1) {
      return res.status(400).json({ error: `payments[${idx}].payment_method_id must be a valid id` });
    }
    const parsedAmount = Number(payment?.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: `payments[${idx}].amount must be greater than zero` });
    }
    parsedPayments.push({
      payment_method_id: parsedMethod,
      amount: roundMoney(parsedAmount),
      reference: safeText(payment?.reference),
    });
  }
  normalizedPayments = parsedPayments;
  const htbMaxDepositPercent = readHtbMaxDepositPercent();
  if (saleType === "htb" && htbMaxDepositPercent === null) {
    return res.status(500).json({
      error: "HTB_MAX_DEPOSIT_PERCENT must be a number greater than 0 and less than 100.",
    });
  }

  const client = await pool.connect();
  try {
    const defaultLocationRaw = req.body?.location_id;
    let resolvedDefaultLocationId = null;
    if (
      defaultLocationRaw !== undefined &&
      defaultLocationRaw !== null &&
      defaultLocationRaw !== ""
    ) {
      const parsed = parseInt(defaultLocationRaw, 10);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return res.status(400).json({ error: "Invalid location_id" });
      }
      resolvedDefaultLocationId = parsed;
    } else {
      const fromEnv = await defaultLocationFromEnv(client, { requireActive: true });
      resolvedDefaultLocationId = fromEnv?.id ?? null;
    }
    const hasDefaultLocation =
      resolvedDefaultLocationId != null &&
      Number.isInteger(resolvedDefaultLocationId) &&
      resolvedDefaultLocationId >= 1;

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

    let loanPaymentMethodId = null;
    if (saleType === "htb") {
      const loanMethodRes = await client.query(
        `SELECT id
         FROM payment_methods
         WHERE COALESCE(is_active, true) = true
           AND UPPER(COALESCE(code, '')) = 'LOAN'
         ORDER BY id ASC
         LIMIT 1`
      );
      if (loanMethodRes.rowCount > 0) {
        loanPaymentMethodId = Number(loanMethodRes.rows[0].id);
      }
    }

    if (normalizedPayments.length > 0) {
      const methodIds = [...new Set(normalizedPayments.map((p) => p.payment_method_id))];
      const methodChk = await client.query(
        `SELECT id
         FROM payment_methods
         WHERE id = ANY($1::int[])
           AND COALESCE(is_active, true) = true`,
        [methodIds]
      );
      if (methodChk.rowCount !== methodIds.length) {
        return res.status(400).json({ error: "One or more selected payment methods are invalid or inactive" });
      }
    }

    const byLocation = new Map();
    for (const L of pricedLines) {
      if (!byLocation.has(L.locationId)) {
        byLocation.set(L.locationId, []);
      }
      byLocation.get(L.locationId).push(L);
    }

    let htbCustomerRecord = null;
    let htbCreditApplicationId = null;
    if (saleType === "htb") {
      htbCustomerRecord = await getFinalApprovedCreditApplicationById(
        req.body?.d365_credit_application_id
      );
      if (!htbCustomerRecord) {
        return res.status(400).json({
          error: "Selected HTB credit application was not found or is not FINAL APPROVED.",
        });
      }
      if (
        htbCustomerRecord.customer365Guid == null ||
        String(htbCustomerRecord.customer365Guid).trim() === ""
      ) {
        return res.status(400).json({
          error: "Selected HTB customer is missing a Dynamics 365 customer id.",
        });
      }
      htbCreditApplicationId =
        htbCustomerRecord.id != null && String(htbCustomerRecord.id).trim() !== ""
          ? String(htbCustomerRecord.id).trim().toLowerCase()
          : null;
    }

    await client.query("BEGIN");

    if (saleType === "htb") {
      const htbId = String(htbCustomerRecord.customer365Guid).trim().toLowerCase();
      const existing = await client.query(
        "SELECT id FROM customers WHERE htb_id = $1::uuid LIMIT 1",
        [htbId]
      );
      if (existing.rowCount > 0) {
        customerId = Number(existing.rows[0].id);
      } else {
        const { rows: insRows } = await client.query(
          `INSERT INTO customers (name, address, htb_id)
           VALUES ($1, $2, $3::uuid)
           RETURNING id`,
          [
            buildLocalHtbCustomerName(htbCustomerRecord),
            htbCustomerRecord.customerAddress
              ? String(htbCustomerRecord.customerAddress).trim()
              : null,
            htbId,
          ]
        );
        customerId = Number(insRows[0].id);
      }
    }

    const invoices = [];
    let invIndex = 0;
    const grandTotal = roundMoney(pricedLines.reduce((s, L) => s + L.lineTotal, 0));
    const paymentsTotal = roundMoney(normalizedPayments.reduce((s, p) => s + p.amount, 0));
    if (saleType !== "htb" && normalizedPayments.length > 0 && paymentsTotal !== grandTotal) {
      return res.status(400).json({
        error: `Payment amount (${paymentsTotal.toFixed(2)}) must equal sale total (${grandTotal.toFixed(2)}).`,
      });
    }
    if (saleType === "htb" && normalizedPayments.length > 0 && paymentsTotal > grandTotal) {
      return res.status(400).json({
        error: `Deposit amount (${paymentsTotal.toFixed(2)}) cannot exceed sale total (${grandTotal.toFixed(2)}).`,
      });
    }
    if (saleType === "htb" && normalizedPayments.length > 0) {
      const maxDeposit = roundMoney((grandTotal * htbMaxDepositPercent) / 100);
      if (paymentsTotal > maxDeposit) {
        return res.status(400).json({
          error: `HTB deposit (${paymentsTotal.toFixed(2)}) cannot exceed ${htbMaxDepositPercent.toFixed(
            2
          )}% of invoice total (${maxDeposit.toFixed(2)}).`,
        });
      }
    }
    if (saleType === "htb" && normalizedPayments.length > 0 && paymentsTotal < grandTotal) {
      if (!Number.isInteger(loanPaymentMethodId) || loanPaymentMethodId < 1) {
        return res.status(400).json({
          error: "HTB balance requires an active LOAN payment method code.",
        });
      }
      normalizedPayments.push({
        payment_method_id: loanPaymentMethodId,
        amount: roundMoney(grandTotal - paymentsTotal),
        reference: null,
      });
    }
    const paymentPool = normalizedPayments.map((p) => ({
      ...p,
      amountCents: moneyToCents(p.amount),
    }));
    for (const [locId, groupLines] of byLocation) {
      const invoiceTotal = roundMoney(groupLines.reduce((s, L) => s + L.lineTotal, 0));
      const invoiceTotalCents = moneyToCents(invoiceTotal);
      const invoiceNumber = `POS-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${invIndex++}`;

      const { rows: invRows } = await client.query(
        `INSERT INTO invoices (
           invoice_number,
           customer_id,
           location_id,
           total,
           status,
           creditapplication_id
         )
         VALUES ($1, $2, $3, $4, 'completed', $5::uuid)
         RETURNING id, invoice_number, customer_id, location_id, total, status, creditapplication_id, created_at`,
        [invoiceNumber, customerId, locId, invoiceTotal, htbCreditApplicationId]
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
      if (paymentPool.length > 0) {
        const invoicePayments = [];
        if (byLocation.size === 1) {
          for (const p of paymentPool) {
            invoicePayments.push({
              payment_method_id: p.payment_method_id,
              amount: p.amount,
              reference: p.reference,
            });
          }
        } else if (paymentPool.length === 1) {
          invoicePayments.push({
            payment_method_id: paymentPool[0].payment_method_id,
            amount: invoiceTotal,
            reference: paymentPool[0].reference,
          });
        } else {
          let remainingInvoiceCents = invoiceTotalCents;
          for (const p of paymentPool) {
            if (remainingInvoiceCents <= 0) break;
            if (p.amountCents <= 0) continue;
            const allocationCents = Math.min(remainingInvoiceCents, p.amountCents);
            if (allocationCents <= 0) continue;
            p.amountCents -= allocationCents;
            remainingInvoiceCents -= allocationCents;
            invoicePayments.push({
              payment_method_id: p.payment_method_id,
              amount: roundMoney(allocationCents / 100),
              reference: p.reference,
            });
          }
          if (remainingInvoiceCents !== 0) {
            return res.status(400).json({
              error: "Could not allocate split payments across invoice locations.",
            });
          }
        }
        for (const p of invoicePayments) {
        await client.query(
          `INSERT INTO payments (invoice_id, payment_method_id, amount, reference)
           VALUES ($1, $2, $3, $4)`,
            [invoice.id, p.payment_method_id, p.amount, p.reference]
        );
        }
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
    if (saleType === "htb" && isDuplicateHtbCreditApplicationError(err)) {
      return res.status(409).json({
        error: "This HTB credit application has already been used for an invoice.",
      });
    }
    sendPgError(res, err);
  } finally {
    client.release();
  }
});

module.exports = router;
