const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, address, is_active, created_at
       FROM location
       ORDER BY name NULLS LAST, code`
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
      `SELECT id, code, name, address, is_active, created_at
       FROM location WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Location not found" });
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

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
    const address =
      req.body?.address === undefined || req.body?.address === null
        ? null
        : String(req.body.address);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);

    const { rows } = await pool.query(
      `INSERT INTO location (code, name, address, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id, code, name, address, is_active, created_at`,
      [String(code).trim(), String(name).trim(), address, isActive]
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
    const code = req.body?.code;
    const name = req.body?.name;
    if (!code || String(code).trim() === "") {
      return res.status(400).json({ error: "Code is required" });
    }
    if (!name || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }
    const address =
      req.body?.address === undefined || req.body?.address === null
        ? null
        : String(req.body.address);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);

    const { rows } = await pool.query(
      `UPDATE location
       SET code = $1, name = $2, address = $3, is_active = $4
       WHERE id = $5
       RETURNING id, code, name, address, is_active, created_at`,
      [String(code).trim(), String(name).trim(), address, isActive, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Location not found" });
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
    const { rowCount } = await pool.query("DELETE FROM location WHERE id = $1", [
      id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Location not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
