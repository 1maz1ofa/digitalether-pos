const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");
const {
  d365Configured,
  d365ConfigError,
  getFinalApprovedCreditApplicationById,
  postLoanTransaction,
} = require("../services/d365Client");

const router = express.Router();

/**
 * After a successful HTB checkout (local DB committed), call Dataverse `htb365_PostLoanTransaction`
 * once per saved invoice. Set to `false` to disable that integration without changing checkout behavior.
 */
const RUN_HTB_D365_LOAN_AFTER_CHECKOUT = true;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX32_RE = /^[0-9a-fA-F]{32}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convert an internal identifier into an iDempiere-style 32-char uppercase hex id.
 * UUIDs / 32-hex strings are normalized; anything else is MD5-hashed for a
 * stable, deterministic surrogate (so subsequent exports of the same row match).
 */
function toIdempiereId(input) {
  if (input === undefined || input === null) return null;
  const text = String(input).trim();
  if (text === "") return null;
  if (UUID_RE.test(text)) return text.replace(/-/g, "").toUpperCase();
  if (HEX32_RE.test(text)) return text.toUpperCase();
  return crypto.createHash("md5").update(text).digest("hex").toUpperCase();
}

function envIdempiereId(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  return toIdempiereId(trimmed);
}

function formatMoneyString(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

function formatQtyString(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(4)));
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function moneyToCents(n) {
  return Math.round(Number(n) * 100);
}

function normalizeVatPercentage(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function vatIncludedAmount(totalIncludingVat, vatPercentage) {
  const total = Number(totalIncludingVat);
  const rate = normalizeVatPercentage(vatPercentage);
  if (!Number.isFinite(total) || total <= 0 || rate <= 0) return 0;
  return (total * rate) / (100 + rate);
}

function safeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function formatInvoiceLocalDate(value) {
  if (value === undefined || value === null) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function calculateHtbInstallmentFromDeposit({
  totalInvoiceAmount,
  depositAmount,
  numberOfInstallmentsMonths,
  interestRate,
  insuranceRate,
  funeralRate,
}) {
  const retailPrice = Number(totalInvoiceAmount);
  const deposit = Number(depositAmount);
  const nper = Number(numberOfInstallmentsMonths);
  const annualInterest = Number(interestRate);
  const insurance = Number(insuranceRate);
  const funeral = Number(funeralRate);
  if (
    !Number.isFinite(retailPrice) ||
    retailPrice < 0 ||
    !Number.isFinite(deposit) ||
    deposit < 0 ||
    !Number.isFinite(nper) ||
    nper <= 0 ||
    !Number.isFinite(annualInterest) ||
    annualInterest < 0 ||
    !Number.isFinite(insurance) ||
    insurance < 0 ||
    !Number.isFinite(funeral) ||
    funeral < 0
  ) {
    return null;
  }
  const monthlyRate = annualInterest / 12;
  const funeralCost = funeral * nper;
  const insuranceCost = (retailPrice * insurance * nper) / 12;
  const totalCost = retailPrice + funeralCost + insuranceCost;
  let loanTotal = totalCost - deposit;
  loanTotal = Math.max(0, loanTotal);
  let installment;
  if (monthlyRate === 0) {
    installment = loanTotal / nper;
  } else {
    installment = (loanTotal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -nper));
  }
  if (!Number.isFinite(installment)) return null;
  return roundMoney(installment);
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

function normalizeGuidLike(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text === "") return null;
  const hexOnly = text
    .toLowerCase()
    .replace(/[{}]/g, "")
    .replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/.test(hexOnly)) return null;
  return hexOnly;
}

function readTerminalLabelFromEnv() {
  const preferredName =
    process.env.TERMINAL_NAME ??
    process.env.terminal_name ??
    process.env.REACT_APP_TERMINAL_NAME ??
    process.env.REACT_APP_terminal_name;
  if (preferredName != null && String(preferredName).trim() !== "") {
    return String(preferredName).trim();
  }
  const fallbackCode =
    process.env.TERMINAL_CODE ??
    process.env.terminal_code ??
    process.env.REACT_APP_TERMINAL_CODE ??
    process.env.REACT_APP_terminal_code;
  if (fallbackCode != null && String(fallbackCode).trim() !== "") {
    return String(fallbackCode).trim();
  }
  return null;
}

function normalizeTerminalMatchValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function parseTerminalCounter(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  try {
    const n = BigInt(String(raw).trim());
    return n >= 0n ? n : null;
  } catch {
    return null;
  }
}

function documentNumberFromTerminal(terminalCode, nextNumber, startingNumber) {
  const safeCode = String(terminalCode || "").trim().toUpperCase();
  const next = parseTerminalCounter(nextNumber);
  const start = parseTerminalCounter(startingNumber);
  if (!safeCode || next === null) return null;
  const width = Math.max(
    String(next).length,
    start !== null ? String(start).length : 0,
    1
  );
  return `${safeCode}-${String(next).padStart(width, "0")}`;
}

async function resolveActiveTerminalForPos(client, locationIdHint = null) {
  const terminalCodeFromEnv = normalizeTerminalMatchValue(
    process.env.TERMINAL_CODE ??
      process.env.terminal_code ??
      process.env.REACT_APP_TERMINAL_CODE ??
      process.env.REACT_APP_terminal_code
  );
  const terminalNameFromEnv = normalizeTerminalMatchValue(
    process.env.TERMINAL_NAME ??
      process.env.terminal_name ??
      process.env.REACT_APP_TERMINAL_NAME ??
      process.env.REACT_APP_terminal_name
  );
  const locationId = Number.isInteger(locationIdHint) && locationIdHint > 0 ? locationIdHint : null;
  const filters = ["COALESCE(t.is_active, true) = true"];
  const values = [];
  let idx = 1;
  if (locationId !== null) {
    filters.push(`t.location_id = $${idx++}`);
    values.push(locationId);
  }
  if (terminalCodeFromEnv) {
    filters.push(`UPPER(TRIM(COALESCE(t.code, ''))) = UPPER($${idx++})`);
    values.push(terminalCodeFromEnv);
  } else if (terminalNameFromEnv) {
    filters.push(`UPPER(TRIM(COALESCE(t.name, ''))) = UPPER($${idx++})`);
    values.push(terminalNameFromEnv);
  }
  const { rows } = await client.query(
    `SELECT t.id, t.code, t.name, t.starting_number, t.next_number
     FROM terminal t
     WHERE ${filters.join(" AND ")}
     ORDER BY t.id ASC
     LIMIT 1`,
    values
  );
  return rows[0] || null;
}

async function defaultLocationFromEnv(client, { requireActive = false } = {}) {
  const rawGuid = branchGuidFromEnv();
  const guidHex = normalizeGuidLike(rawGuid);
  if (!guidHex) return null;
  const where = requireActive
    ? "LOWER(REPLACE(REPLACE(TRIM(d365_id::text), '-', ''), '{', '')) = $1 AND COALESCE(is_active, true) = true"
    : "LOWER(REPLACE(REPLACE(TRIM(d365_id::text), '-', ''), '{', '')) = $1";
  const { rows } = await client.query(
    `SELECT id, name, code
     FROM location
     WHERE ${where}
     ORDER BY id ASC
     LIMIT 1`,
    [guidHex]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    name: row.name ? String(row.name).trim() : null,
    code: row.code ? String(row.code).trim() : null,
  };
}

router.get("/debug/default-location", async (req, res) => {
  try {
    const rawGuid =
      process.env.D365_BRANCH_ID ??
      process.env.d365_branch_id ??
      process.env.BRANCH_ID ??
      process.env.branch_id ??
      null;
    const normalizedGuid = normalizeGuidLike(rawGuid);
    const locations = normalizedGuid
      ? (
          await pool.query(
            `SELECT id, code, name, d365_id::text AS d365_id, COALESCE(is_active, true) AS is_active
             FROM location
             WHERE LOWER(REPLACE(REPLACE(REPLACE(TRIM(d365_id::text), '-', ''), '{', ''), '}', '')) = $1
             ORDER BY id ASC`,
            [normalizedGuid]
          )
        ).rows
      : [];
    const activeLocation =
      locations.find((row) => row.is_active === true) || null;
    const resolved = await defaultLocationFromEnv(pool, { requireActive: true });
    const terminal = await resolveActiveTerminalForPos(
      pool,
      resolved?.id ?? null
    );

    return res.json({
      branchEnv: {
        raw: rawGuid,
        normalized: normalizedGuid,
        hasValidGuidFormat: normalizedGuid != null,
      },
      matches: {
        locationsByBranchGuid: locations,
        activeLocationFromMatches: activeLocation,
        resolvedDefaultLocation: resolved,
        resolvedTerminal: terminal
          ? {
              id: terminal.id,
              code: terminal.code ?? null,
              name: terminal.name ?? null,
              starting_number: terminal.starting_number ?? null,
              next_number: terminal.next_number ?? null,
            }
          : null,
      },
      tips: [
        "branchEnv.normalized must not be null.",
        "matches.locationsByBranchGuid should contain at least one row.",
        "At least one matched location must have is_active=true.",
        "matches.resolvedTerminal should be non-null for checkout.",
      ],
    });
  } catch (err) {
    sendPgError(res, err);
  }
});

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
    const terminal = await resolveActiveTerminalForPos(pool, fromEnv?.id ?? null);
    const htbMaxDepositPercent = readHtbMaxDepositPercent();
    const terminalLabel = readTerminalLabelFromEnv();
    if (htbMaxDepositPercent === null) {
      return res.status(500).json({
        error: "HTB_MAX_DEPOSIT_PERCENT must be a number greater than 0 and less than 100.",
      });
    }
    res.json({
      defaultLocationId: fromEnv?.id ?? null,
      branchName: fromEnv?.name || fromEnv?.code || null,
      terminalName: terminal?.name || terminal?.code || terminalLabel,
      terminalId: terminal?.id ?? null,
      nextDocumentNumber: terminal
        ? documentNumberFromTerminal(terminal.code, terminal.next_number, terminal.starting_number)
        : null,
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
       WHERE COALESCE(active, 1) = 1
       ORDER BY COALESCE(position, 2147483647) ASC, id ASC`
    );
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.get("/sale-types", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, position
       FROM sale_type
       ORDER BY COALESCE(position, 2147483647) ASC, code ASC`
    );
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.get("/invoices", async (req, res) => {
  try {
    let dateParam = safeText(req.query?.date);
    if (dateParam && !ISO_DATE_RE.test(dateParam)) {
      return res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
    }
    if (!dateParam) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      dateParam = `${yyyy}-${mm}-${dd}`;
    }

    const { rows } = await pool.query(
      `SELECT
         i.id,
         i.invoice_number,
         i.reference_number,
         i.created_at,
         i.status,
         i.total,
         i.subtotal,
         i.vat,
         i.creditapplication_id,
         cu.name AS customer_name,
         loc.name AS location_name,
         loc.code AS location_code,
         cur.code AS currency_code,
         st.code AS sale_type_code,
         st.name AS sale_type_name
       FROM invoices i
       LEFT JOIN customers cu ON cu.id = i.customer_id
       LEFT JOIN location loc ON loc.id = i.location_id
       LEFT JOIN currency cur ON cur.id = i.currency_id
       LEFT JOIN sale_type st ON st.id = i.sale_type_id
       WHERE i.created_at::date = $1::date
       ORDER BY i.created_at DESC, i.id DESC`,
      [dateParam]
    );

    res.json({
      date: dateParam,
      invoices: rows,
    });
  } catch (err) {
    sendPgError(res, err);
  }
});

/**
 * GET /api/pos/htb/export
 * Returns completed HTB invoices created on a given date, formatted for iDempiere/ADempiere ingest.
 * Query: ?date=YYYY-MM-DD (defaults to today, server local date)
 * Shape: { invoices: [{ invoice, lines, payments }] }
 *
 * 32-char hex IDs are derived from existing identifiers:
 *   - c_invoice_id   ← MD5(invoice_number)
 *   - c_bpartner_id  ← customers.htb_id (UUID, dashes stripped) or MD5(customer.id)
 *   - m_product_id   ← MD5(product.code) (or product.code if it is already a 32-hex/UUID)
 *   - ad_org_id      ← location.d365_id (UUID) or env IDEMPIERE_AD_ORG_ID
 *   - ad_client_id   ← env IDEMPIERE_AD_CLIENT_ID
 */
router.get("/htb/export", async (req, res) => {
  try {
    let dateParam = safeText(req.query?.date);
    if (dateParam && !ISO_DATE_RE.test(dateParam)) {
      return res.status(400).json({ error: "date must be in YYYY-MM-DD format" });
    }
    if (!dateParam) {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      dateParam = `${yyyy}-${mm}-${dd}`;
    }

    const adClientId = envIdempiereId("IDEMPIERE_AD_CLIENT_ID");
    const adOrgIdFallback = envIdempiereId("IDEMPIERE_AD_ORG_ID");
    const bpartnerFallback = envIdempiereId("IDEMPIERE_DEFAULT_BPARTNER_ID");

    const sql = `
      SELECT
        i.id,
        i.invoice_number,
        i.reference_number,
        i.total,
        to_char(i.created_at, 'YYYY-MM-DD') AS dateinvoiced,
        cu.id  AS customer_id,
        cu.htb_id::text AS customer_htb_id,
        cu.name AS customer_name,
        cur.code AS currency_code,
        loc.d365_id::text AS location_d365_id,
        loc.code AS location_code,
        COALESCE(
          (
            SELECT json_agg(
                     json_build_object(
                       'quantity', ii.quantity,
                       'total', ii.total,
                       'product_code', p.code,
                       'product_name', p.name
                     ) ORDER BY ii.id
                   )
            FROM invoice_items ii
            LEFT JOIN product p ON p.id = ii.product_id
            WHERE ii.invoice_id = i.id
          ),
          '[]'::json
        ) AS items,
        COALESCE(
          (
            SELECT json_agg(
                     json_build_object(
                       'amount', pay.amount,
                       'payment_method_code', pm.code,
                       'payment_method_name', pm.name
                     ) ORDER BY pay.id
                   )
            FROM payments pay
            LEFT JOIN payment_methods pm ON pm.id = pay.payment_method_id
            WHERE pay.invoice_id = i.id
          ),
          '[]'::json
        ) AS payments
      FROM invoices i
      JOIN sale_type st ON st.id = i.sale_type_id
      LEFT JOIN customers cu ON cu.id = i.customer_id
      LEFT JOIN currency  cur ON cur.id = i.currency_id
      LEFT JOIN location  loc ON loc.id = i.location_id
      WHERE LOWER(COALESCE(st.code, '')) = 'htb'
        AND i.created_at::date = $1::date
      ORDER BY i.id ASC
    `;
    const { rows } = await pool.query(sql, [dateParam]);

    const invoices = rows.map((row) => {
      const adOrgId = toIdempiereId(row.location_d365_id) || adOrgIdFallback;
      const bpartnerId =
        toIdempiereId(row.customer_htb_id) ||
        (row.customer_id != null
          ? toIdempiereId(`customer:${row.customer_id}`)
          : null) ||
        bpartnerFallback;
      const invoiceGuid = toIdempiereId(row.invoice_number || `invoice:${row.id}`);

      const lines = Array.isArray(row.items)
        ? row.items.map((line) => ({
            qtyinvoiced: formatQtyString(line.quantity),
            m_product_id: toIdempiereId(line.product_code),
            line_gross_amount: formatMoneyString(line.total),
            product_name: line.product_name ?? null,
          }))
        : [];

      const payments = Array.isArray(row.payments)
        ? row.payments.map((p) => ({
            amount: formatMoneyString(p.amount),
            payment_method:
              String(p.payment_method_code || "").trim().toUpperCase() === "LOAN"
                ? "HTB DOLLARS"
                : (p.payment_method_name && String(p.payment_method_name).trim()) ||
                  (p.payment_method_code && String(p.payment_method_code).trim()) ||
                  null,
          }))
        : [];

      return {
        invoice: {
          poreference: row.reference_number ?? null,
          grandtotal: formatMoneyString(row.total),
          c_invoice_id: invoiceGuid,
          dateinvoiced: row.dateinvoiced,
          documentno: row.invoice_number,
          ad_client_id: adClientId,
          ad_org_id: adOrgId,
          c_bpartner_id: bpartnerId,
          currency: row.currency_code ?? null,
        },
        lines,
        payments,
      };
    });

    res.json({ invoices });
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
  const rawCurrencyId = req.body?.currency_id;
  const parsedCurrencyId = parseInt(rawCurrencyId, 10);
  if (!Number.isInteger(parsedCurrencyId) || parsedCurrencyId < 1) {
    return res.status(400).json({ error: "Invalid currency_id" });
  }

  const saleType = safeText(req.body?.sale_type)?.toLowerCase();
  let saleTypeId = null;
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
    const currencyChk = await client.query(
      "SELECT code FROM currency WHERE id = $1 AND COALESCE(is_active, true) = true",
      [parsedCurrencyId]
    );
    if (!currencyChk.rowCount) {
      return res.status(400).json({ error: "Selected currency is invalid or inactive" });
    }
    const currencyCode =
      currencyChk.rows[0].code != null ? String(currencyChk.rows[0].code).trim() : "";
    if (saleType) {
      const saleTypeRow = await client.query(
        `SELECT id
         FROM sale_type
         WHERE LOWER(COALESCE(code, '')) = $1
         LIMIT 1`,
        [saleType]
      );
      if (!saleTypeRow.rowCount) {
        return res.status(400).json({ error: "Invalid sale_type" });
      }
      saleTypeId = Number(saleTypeRow.rows[0].id);
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
        `SELECT p.id, p.unit_price, p.is_active, v.percentage AS vat_percentage
         FROM product p
         LEFT JOIN vat v ON v.id = p.vat_id
         WHERE p.id = $1`,
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
      const vatPercentage = normalizeVatPercentage(p.vat_percentage);
      const lineVatAmount = roundMoney(vatIncludedAmount(lineTotal, vatPercentage));
      const lineSubTotal = roundMoney(lineTotal - lineVatAmount);
      pricedLines.push({
        productId,
        qty,
        unitPrice,
        vatPercentage,
        lineSubTotal,
        lineVatAmount,
        lineTotal,
        locationId: lineLocationId,
      });
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
         WHERE COALESCE(active, 1) = 1
           AND UPPER(COALESCE(code, '')) = 'LOAN'
         ORDER BY COALESCE(position, 2147483647) ASC, id ASC
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
           AND COALESCE(active, 1) = 1`,
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
    let htbCapNumber = null;
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
      htbCapNumber = safeText(htbCustomerRecord?.capNumber);
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

    const terminal = await resolveActiveTerminalForPos(client, resolvedDefaultLocationId);
    if (!terminal) {
      return res.status(400).json({
        error: "No active terminal found for POS. Configure an active terminal first.",
      });
    }
    const terminalLockedRows = await client.query(
      `SELECT id, code, name, starting_number, next_number
       FROM terminal
       WHERE id = $1
       FOR UPDATE`,
      [terminal.id]
    );
    if (!terminalLockedRows.rowCount) {
      return res.status(400).json({ error: "Configured terminal was not found." });
    }
    const terminalLocked = terminalLockedRows.rows[0];
    const terminalNextNumber = parseTerminalCounter(terminalLocked.next_number);
    if (terminalNextNumber === null) {
      return res.status(400).json({
        error: "Configured terminal has an invalid next document number.",
      });
    }
    const baseDocumentNumber = documentNumberFromTerminal(
      terminalLocked.code,
      terminalLocked.next_number,
      terminalLocked.starting_number
    );
    if (!baseDocumentNumber) {
      return res.status(400).json({
        error: "Configured terminal is missing a code required for document numbering.",
      });
    }

    const invoices = [];
    let invIndex = 0;
    const grandSubTotal = roundMoney(pricedLines.reduce((s, L) => s + L.lineSubTotal, 0));
    const grandVatAmount = roundMoney(pricedLines.reduce((s, L) => s + L.lineVatAmount, 0));
    const grandTotal = roundMoney(grandSubTotal + grandVatAmount);
    const paymentsTotal = roundMoney(normalizedPayments.reduce((s, p) => s + p.amount, 0));
    if (saleType !== "htb" && normalizedPayments.length > 0 && paymentsTotal < grandTotal) {
      return res.status(400).json({
        error: `Payment amount (${paymentsTotal.toFixed(2)}) is less than sale total (${grandTotal.toFixed(2)}).`,
      });
    }
    if (saleType === "htb" && normalizedPayments.length > 0 && paymentsTotal > grandTotal) {
      return res.status(400).json({
        error: `Deposit amount (${paymentsTotal.toFixed(2)}) cannot exceed sale total (${grandTotal.toFixed(2)}).`,
      });
    }
    if (saleType === "htb" && normalizedPayments.length > 0) {
      const allowedInstallment = Number(htbCustomerRecord?.installmentAmount);
      if (!Number.isFinite(allowedInstallment) || allowedInstallment < 0) {
        return res.status(400).json({
          error: "Selected HTB credit application is missing a valid approved installment amount.",
        });
      }
      const resultingInstallment = calculateHtbInstallmentFromDeposit({
        totalInvoiceAmount: grandTotal,
        depositAmount: paymentsTotal,
        numberOfInstallmentsMonths: htbCustomerRecord?.numberOfInstallmentsMonths,
        interestRate: htbCustomerRecord?.interestRate,
        insuranceRate: htbCustomerRecord?.insuranceRate,
        funeralRate: htbCustomerRecord?.funeralRate,
      });
      if (resultingInstallment === null) {
        return res.status(400).json({
          error: "Selected HTB credit application is missing rates or installment period required for installment calculation.",
        });
      }
      if (resultingInstallment > roundMoney(allowedInstallment)) {
        return res.status(400).json({
          error: `Resulting installment (${resultingInstallment.toFixed(
            2
          )}) exceeds approved installment (${roundMoney(allowedInstallment).toFixed(2)}). Increase the deposit amount.`,
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
    const runHtbLoanAfterCheckout =
      RUN_HTB_D365_LOAN_AFTER_CHECKOUT && saleType === "htb" && d365Configured();
    const htbD365LoanBodies = runHtbLoanAfterCheckout ? [] : null;
    let paymentMethodRowById = null;
    if (runHtbLoanAfterCheckout && paymentPool.length > 0) {
      const pmIds = [...new Set(paymentPool.map((p) => p.payment_method_id))];
      const pmRes = await client.query(
        `SELECT id, code, name FROM payment_methods WHERE id = ANY($1::int[])`,
        [pmIds]
      );
      paymentMethodRowById = new Map(pmRes.rows.map((r) => [Number(r.id), r]));
    }
    const distinctPaymentReferences = Array.from(
      new Set(
        paymentPool
          .map((p) => safeText(p.reference))
          .filter((reference) => reference !== null)
      )
    );
    const invoiceReferenceNumber =
      saleType === "htb" && htbCapNumber
        ? htbCapNumber
        : distinctPaymentReferences.length === 1
          ? distinctPaymentReferences[0]
          : null;
    for (const [locId, groupLines] of byLocation) {
      const invoiceSubTotal = roundMoney(groupLines.reduce((s, L) => s + L.lineSubTotal, 0));
      const invoiceVatAmount = roundMoney(groupLines.reduce((s, L) => s + L.lineVatAmount, 0));
      const invoiceTotal = roundMoney(invoiceSubTotal + invoiceVatAmount);
      const invoiceTotalCents = moneyToCents(invoiceTotal);
      const invoiceNumber =
        byLocation.size === 1 ? baseDocumentNumber : `${baseDocumentNumber}-${invIndex++}`;

      const { rows: invRows } = await client.query(
        `INSERT INTO invoices (
           invoice_number,
           customer_id,
           location_id,
           subtotal,
           vat,
           total,
           status,
           currency_id,
           sale_type_id,
           creditapplication_id,
           reference_number
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9::uuid, $10)
         RETURNING id, invoice_number, customer_id, location_id, subtotal, vat, total, status, currency_id, sale_type_id, creditapplication_id, reference_number, created_at`,
        [
          invoiceNumber,
          customerId,
          locId,
          invoiceSubTotal,
          invoiceVatAmount,
          invoiceTotal,
          parsedCurrencyId,
          saleTypeId,
          htbCreditApplicationId,
          invoiceReferenceNumber,
        ]
      );
      const invoice = invRows[0];

      const savedItems = [];
      for (const L of groupLines) {
        const { rows: itemRows } = await client.query(
          `INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, subtotal, vat, total)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, product_id, quantity, unit_price, subtotal, vat, total`,
          [invoice.id, L.productId, L.qty, L.unitPrice, L.lineSubTotal, L.lineVatAmount, L.lineTotal]
        );
        savedItems.push(itemRows[0]);
      }
      if (paymentPool.length > 0) {
        const invoicePayments = [];
        if (byLocation.size === 1) {
          let remainingInvoiceCents = invoiceTotalCents;
          for (const p of paymentPool) {
            if (remainingInvoiceCents <= 0) break;
            if (p.amountCents <= 0) continue;
            const allocationCents = Math.min(remainingInvoiceCents, p.amountCents);
            if (allocationCents <= 0) continue;
            remainingInvoiceCents -= allocationCents;
            invoicePayments.push({
              payment_method_id: p.payment_method_id,
              amount: roundMoney(allocationCents / 100),
              reference: p.reference,
            });
          }
          if (remainingInvoiceCents !== 0) {
            return res.status(400).json({
              error: "Could not allocate payments to this invoice.",
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
            `INSERT INTO payments (invoice_id, payment_method_id, amount)
             VALUES ($1, $2, $3)`,
            [invoice.id, p.payment_method_id, p.amount]
          );
        }
        if (
          htbD365LoanBodies !== null &&
          invoicePayments.length > 0 &&
          paymentMethodRowById instanceof Map
        ) {
          const paymentsForD365 = invoicePayments.map((p) => {
            const row = paymentMethodRowById.get(p.payment_method_id);
            const code = String(row?.code || "").trim().toUpperCase();
            const payment_method =
              code === "LOAN"
                ? "HTB DOLLARS"
                : (row?.name != null ? String(row.name).trim() : "") ||
                  (row?.code != null ? String(row.code).trim() : "") ||
                  "UNKNOWN";
            return {
              amount: formatMoneyString(p.amount) ?? String(p.amount),
              payment_method,
            };
          });
          htbD365LoanBodies.push({
            poreference:
              invoice.reference_number != null ? String(invoice.reference_number).trim() : "",
            grandtotal: formatMoneyString(invoice.total) ?? String(invoice.total),
            documentno: String(invoice.invoice_number),
            dateinvoiced: formatInvoiceLocalDate(invoice.created_at),
            currency: currencyCode,
            payments: paymentsForD365,
          });
        }
      }
      invoices.push({ invoice, items: savedItems });
    }

    await client.query(
      `UPDATE terminal
       SET next_number = $1
       WHERE id = $2`,
      [(terminalNextNumber + 1n).toString(), terminalLocked.id]
    );

    await client.query("COMMIT");

    let htbD365Loan = null;
    if (runHtbLoanAfterCheckout && htbD365LoanBodies && htbD365LoanBodies.length > 0) {
      const attempts = [];
      for (const loanBody of htbD365LoanBodies) {
        try {
          const data = await postLoanTransaction(loanBody);
          attempts.push({ documentno: loanBody.documentno, ok: true, data: data ?? null });
        } catch (loanErr) {
          console.error("[pos/checkout] HTB postLoanTransaction failed:", loanErr.message);
          attempts.push({
            documentno: loanBody.documentno,
            ok: false,
            error: loanErr.message || String(loanErr),
          });
        }
      }
      htbD365Loan = { attempts, allOk: attempts.every((a) => a.ok) };
    }

    res.status(201).json({
      invoices,
      nextDocumentNumber: documentNumberFromTerminal(
        terminalLocked.code,
        (terminalNextNumber + 1n).toString(),
        terminalLocked.starting_number
      ),
      ...(htbD365Loan ? { htbD365Loan } : {}),
    });
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
