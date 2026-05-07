const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");

const router = express.Router();

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, symbol, is_active, is_default, created_at
       FROM currency
       ORDER BY code, id`
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
      `SELECT id, code, name, symbol, is_active, is_default, created_at
       FROM currency
       WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Currency not found" });
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    const code = normalizeCode(req.body?.code);
    const name = String(req.body?.name || "").trim();
    const symbolRaw = req.body?.symbol;
    const symbol = symbolRaw === undefined || symbolRaw === null ? null : String(symbolRaw).trim();
    const is_active = req.body?.is_active !== undefined ? Boolean(req.body.is_active) : true;
    const is_default =
      req.body?.is_default !== undefined ? Boolean(req.body.is_default) : false;

    if (!code || code.length !== 3) {
      return res.status(400).json({ error: "Code must be exactly 3 characters" });
    }
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (is_default) {
        await client.query("UPDATE currency SET is_default = false WHERE is_default = true");
      }
      const { rows } = await client.query(
        `INSERT INTO currency (code, name, symbol, is_active, is_default)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, code, name, symbol, is_active, is_default, created_at`,
        [code, name, symbol || null, is_active, is_default]
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

    const code = normalizeCode(req.body?.code);
    const name = String(req.body?.name || "").trim();
    const symbolRaw = req.body?.symbol;
    const symbol = symbolRaw === undefined || symbolRaw === null ? null : String(symbolRaw).trim();
    const is_active = req.body?.is_active !== undefined ? Boolean(req.body.is_active) : true;
    const is_default =
      req.body?.is_default !== undefined ? Boolean(req.body.is_default) : false;

    if (!code || code.length !== 3) {
      return res.status(400).json({ error: "Code must be exactly 3 characters" });
    }
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (is_default) {
        await client.query(
          "UPDATE currency SET is_default = false WHERE is_default = true AND id <> $1",
          [id]
        );
      }
      const { rows } = await client.query(
        `UPDATE currency
         SET code = $1, name = $2, symbol = $3, is_active = $4, is_default = $5
         WHERE id = $6
         RETURNING id, code, name, symbol, is_active, is_default, created_at`,
        [code, name, symbol || null, is_active, is_default, id]
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Currency not found" });
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
    const { rowCount } = await pool.query("DELETE FROM currency WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Currency not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
