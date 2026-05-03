const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name FROM category ORDER BY name NULLS LAST, id"
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
      "SELECT id, name FROM category WHERE id = $1",
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Category not found" });
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    const name = req.body?.name;
    if (name === undefined || name === null || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }
    const { rows } = await pool.query(
      "INSERT INTO category (name) VALUES ($1) RETURNING id, name",
      [String(name).trim()]
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
    if (name === undefined || name === null || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }
    const { rows } = await pool.query(
      "UPDATE category SET name = $1 WHERE id = $2 RETURNING id, name",
      [String(name).trim(), id]
    );
    if (!rows.length) return res.status(404).json({ error: "Category not found" });
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
    const { rowCount } = await pool.query("DELETE FROM category WHERE id = $1", [
      id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Category not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
