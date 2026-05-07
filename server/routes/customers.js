const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, phone, email, address, is_default, created_at
       FROM customers
       ORDER BY name NULLS LAST, id`
    );
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
    const { rows } = await pool.query(
      `SELECT id, name, phone, email, address, is_default, created_at
       FROM customers WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Customer not found" });
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

function emptyToNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

router.post("/", async (req, res) => {
  try {
    const name = req.body?.name;
    if (!name || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }
    const phone = emptyToNull(req.body?.phone);
    const email = emptyToNull(req.body?.email);
    const address = emptyToNull(req.body?.address);

    const { rows } = await pool.query(
      `INSERT INTO customers (name, phone, email, address)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, phone, email, address, is_default, created_at`,
      [String(name).trim(), phone, email, address]
    );
    res.status(201).json(rows[0]);
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
    const name = req.body?.name;
    if (!name || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }
    const phone = emptyToNull(req.body?.phone);
    const email = emptyToNull(req.body?.email);
    const address = emptyToNull(req.body?.address);

    const { rows } = await pool.query(
      `UPDATE customers
       SET name = $1, phone = $2, email = $3, address = $4
       WHERE id = $5
       RETURNING id, name, phone, email, address, is_default, created_at`,
      [String(name).trim(), phone, email, address, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Customer not found" });
    res.json(rows[0]);
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
    const { rowCount } = await pool.query("DELETE FROM customers WHERE id = $1", [
      id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Customer not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
