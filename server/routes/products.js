const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

const listSql = `
  SELECT p.id, p.code, p.name, p.description, p.barcode, p.unit_of_measure,
         p.category_id, c.name AS category_name,
         p.unit_cost, p.unit_price, p.price_includes_vat, p.is_active,
         p.reorder_level, p.created_at
  FROM product p
  LEFT JOIN category c ON c.id = p.category_id
`;

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`${listSql} ORDER BY p.name NULLS LAST, p.code`);
    res.json(rows);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const { rows } = await pool.query(`${listSql} WHERE p.id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Product not found" });
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

function parseOptionalNumber(val) {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(val) {
  if (val === undefined || val === null || val === "") return null;
  const n = parseInt(val, 10);
  return Number.isInteger(n) ? n : null;
}

router.post("/", async (req, res) => {
  try {
    const code = req.body?.code;
    const name = req.body?.name;
    if (!code || String(code).trim() === "") {
      return res.status(400).json({ error: "Code is required" });
    }
    if (!name || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }

    const description =
      req.body?.description === undefined || req.body?.description === null
        ? null
        : String(req.body.description);
    const barcode =
      req.body?.barcode === undefined || req.body?.barcode === null
        ? null
        : String(req.body.barcode);
    const unitOfMeasure =
      req.body?.unit_of_measure === undefined || req.body?.unit_of_measure === null
        ? null
        : String(req.body.unit_of_measure);
    const categoryId = parseOptionalInt(req.body?.category_id);
    const unitCost = parseOptionalNumber(req.body?.unit_cost);
    const unitPrice = parseOptionalNumber(req.body?.unit_price);
    const priceIncludesVat =
      req.body?.price_includes_vat === undefined
        ? null
        : Boolean(req.body.price_includes_vat);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);
    const reorderLevel = parseOptionalInt(req.body?.reorder_level);

    if (categoryId !== null) {
      const chk = await pool.query("SELECT 1 FROM category WHERE id = $1", [
        categoryId,
      ]);
      if (!chk.rowCount) {
        return res.status(400).json({ error: "Invalid category_id" });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO product (
        code, name, description, barcode, unit_of_measure, category_id,
        unit_cost, unit_price, price_includes_vat, is_active, reorder_level
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id`,
      [
        String(code).trim(),
        String(name).trim(),
        description,
        barcode,
        unitOfMeasure,
        categoryId,
        unitCost,
        unitPrice,
        priceIncludesVat,
        isActive,
        reorderLevel,
      ]
    );
    const newId = rows[0].id;
    const detail = await pool.query(`${listSql} WHERE p.id = $1`, [newId]);
    res.status(201).json(detail.rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const code = req.body?.code;
    const name = req.body?.name;
    if (!code || String(code).trim() === "") {
      return res.status(400).json({ error: "Code is required" });
    }
    if (!name || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }

    const description =
      req.body?.description === undefined || req.body?.description === null
        ? null
        : String(req.body.description);
    const barcode =
      req.body?.barcode === undefined || req.body?.barcode === null
        ? null
        : String(req.body.barcode);
    const unitOfMeasure =
      req.body?.unit_of_measure === undefined || req.body?.unit_of_measure === null
        ? null
        : String(req.body.unit_of_measure);
    const categoryId = parseOptionalInt(req.body?.category_id);
    const unitCost = parseOptionalNumber(req.body?.unit_cost);
    const unitPrice = parseOptionalNumber(req.body?.unit_price);
    const priceIncludesVat =
      req.body?.price_includes_vat === undefined
        ? null
        : Boolean(req.body.price_includes_vat);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);
    const reorderLevel = parseOptionalInt(req.body?.reorder_level);

    if (categoryId !== null) {
      const chk = await pool.query("SELECT 1 FROM category WHERE id = $1", [
        categoryId,
      ]);
      if (!chk.rowCount) {
        return res.status(400).json({ error: "Invalid category_id" });
      }
    }

    const { rows } = await pool.query(
      `UPDATE product SET
        code = $1, name = $2, description = $3, barcode = $4, unit_of_measure = $5,
        category_id = $6, unit_cost = $7, unit_price = $8, price_includes_vat = $9,
        is_active = $10, reorder_level = $11
      WHERE id = $12
      RETURNING id`,
      [
        String(code).trim(),
        String(name).trim(),
        description,
        barcode,
        unitOfMeasure,
        categoryId,
        unitCost,
        unitPrice,
        priceIncludesVat,
        isActive,
        reorderLevel,
        id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: "Product not found" });
    const detail = await pool.query(`${listSql} WHERE p.id = $1`, [id]);
    res.json(detail.rows[0]);
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
    const { rowCount } = await pool.query("DELETE FROM product WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Product not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
