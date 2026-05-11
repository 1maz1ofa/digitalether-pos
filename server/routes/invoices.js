const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayLocalIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

router.get("/", async (req, res) => {
  try {
    const rawFrom = req.query?.from == null ? "" : String(req.query.from).trim();
    const rawTo = req.query?.to == null ? "" : String(req.query.to).trim();
    const rawSaleTypeId =
      req.query?.saleTypeId == null ? "" : String(req.query.saleTypeId).trim();
    const selectedFrom = rawFrom === "" ? todayLocalIsoDate() : rawFrom;
    const selectedTo = rawTo === "" ? todayLocalIsoDate() : rawTo;
    const selectedSaleTypeId = rawSaleTypeId === "" ? null : Number(rawSaleTypeId);

    if (!ISO_DATE_RE.test(selectedFrom)) {
      return res.status(400).json({ error: "from must be in YYYY-MM-DD format" });
    }
    if (!ISO_DATE_RE.test(selectedTo)) {
      return res.status(400).json({ error: "to must be in YYYY-MM-DD format" });
    }
    if (selectedFrom > selectedTo) {
      return res.status(400).json({ error: "from date cannot be after to date" });
    }
    if (
      selectedSaleTypeId !== null &&
      (!Number.isInteger(selectedSaleTypeId) || selectedSaleTypeId <= 0)
    ) {
      return res
        .status(400)
        .json({ error: "saleTypeId must be a positive integer when provided" });
    }

    const { rows } = await pool.query(
      `SELECT
         i.id,
         i.invoice_number,
         i.reference_number,
         i.status,
         i.subtotal,
         i.vat,
         i.total,
         i.created_at,
         c.id AS customer_id,
         c.name AS customer_name,
         l.id AS location_id,
         l.name AS location_name,
         l.code AS location_code,
         cur.code AS currency_code,
         st.code AS sale_type_code,
         st.name AS sale_type_name
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN location l ON l.id = i.location_id
       LEFT JOIN currency cur ON cur.id = i.currency_id
       LEFT JOIN sale_type st ON st.id = i.sale_type_id
       WHERE i.created_at::date BETWEEN $1::date AND $2::date
         AND ($3::int IS NULL OR i.sale_type_id = $3::int)
       ORDER BY i.created_at DESC, i.id DESC`,
      [selectedFrom, selectedTo, selectedSaleTypeId]
    );

    res.json({
      from: selectedFrom,
      to: selectedTo,
      saleTypeId: selectedSaleTypeId,
      invoices: rows,
    });
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
