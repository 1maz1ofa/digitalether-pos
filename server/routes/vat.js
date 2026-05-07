const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

function parseVatPercentage(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(2));
}

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, percentage, is_active, is_default, created_at
       FROM vat
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
      `SELECT id, name, percentage, is_active, is_default, created_at
       FROM vat
       WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "VAT not found" });
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const percentage = parseVatPercentage(req.body?.percentage);
    const is_active = req.body?.is_active !== undefined ? Boolean(req.body.is_active) : true;
    const is_default = req.body?.is_default !== undefined ? Boolean(req.body.is_default) : false;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (percentage === null || percentage < 0 || percentage > 100) {
      return res.status(400).json({ error: "Percentage must be between 0 and 100" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (is_default) {
        await client.query("UPDATE vat SET is_default = false WHERE is_default = true");
      }
      const { rows } = await client.query(
        `INSERT INTO vat (name, percentage, is_active, is_default)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, percentage, is_active, is_default, created_at`,
        [name, percentage, is_active, is_default]
      );
      await client.query("COMMIT");
      res.status(201).json(rows[0]);
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
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

    const name = String(req.body?.name || "").trim();
    const percentage = parseVatPercentage(req.body?.percentage);
    const is_active = req.body?.is_active !== undefined ? Boolean(req.body.is_active) : true;
    const is_default = req.body?.is_default !== undefined ? Boolean(req.body.is_default) : false;

    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (percentage === null || percentage < 0 || percentage > 100) {
      return res.status(400).json({ error: "Percentage must be between 0 and 100" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (is_default) {
        await client.query("UPDATE vat SET is_default = false WHERE id <> $1 AND is_default = true", [id]);
      }
      const { rows } = await client.query(
        `UPDATE vat
         SET name = $1, percentage = $2, is_active = $3, is_default = $4
         WHERE id = $5
         RETURNING id, name, percentage, is_active, is_default, created_at`,
        [name, percentage, is_active, is_default, id]
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "VAT not found" });
      }
      await client.query("COMMIT");
      res.json(rows[0]);
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }
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
    const { rowCount } = await pool.query("DELETE FROM vat WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "VAT not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
