const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");
const {
  getUserLocationId,
  sendLocationForbidden,
} = require("../utils/userLocationScope");
const { requireTableAccess } = require("../middleware/requireTableAccess");

const router = express.Router();
router.use(requireTableAccess("location"));

router.get("/", async (req, res) => {
  try {
    const userLoc = getUserLocationId(req.user);
    const params = [];
    const where = userLoc != null ? "WHERE id = $1" : "";
    if (userLoc != null) params.push(userLoc);
    const { rows } = await pool.query(
      `SELECT id, code, name, d365_id, address, is_active, created_at
       FROM location
       ${where}
       ORDER BY name NULLS LAST, code`,
      params
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
      `SELECT id, code, name, d365_id, address, is_active, created_at
       FROM location WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Location not found" });
    const userLoc = getUserLocationId(req.user);
    if (userLoc != null && Number(rows[0].id) !== userLoc) {
      return sendLocationForbidden(res);
    }
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    const code = req.body?.code;
    if (!code || String(code).trim() === "") {
      return res.status(400).json({ error: "Code is required" });
    }
    const codeValue = String(code).trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(codeValue)) {
      return res
        .status(400)
        .json({ error: "Code must be exactly 3 characters (letters/numbers only)" });
    }

    const name = req.body?.name;
    if (!name || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }
    const d365Id = req.body?.d365_id;
    if (!d365Id || String(d365Id).trim() === "") {
      return res.status(400).json({ error: "d365_id is required" });
    }
    const address =
      req.body?.address === undefined || req.body?.address === null
        ? null
        : String(req.body.address);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);

    const { rows } = await pool.query(
      `INSERT INTO location (code, name, d365_id, address, is_active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, d365_id, address, is_active, created_at`,
      [codeValue, String(name).trim(), String(d365Id).trim(), address, isActive]
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
    if (!name || String(name).trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }
    const d365Id = req.body?.d365_id;
    if (!d365Id || String(d365Id).trim() === "") {
      return res.status(400).json({ error: "d365_id is required" });
    }
    const address =
      req.body?.address === undefined || req.body?.address === null
        ? null
        : String(req.body.address);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);

    const codeValue =
      code === undefined || code === null || String(code).trim() === ""
        ? null
        : String(code).trim();
    if (codeValue !== null && !/^[A-Z0-9]{3}$/.test(codeValue.toUpperCase())) {
      return res
        .status(400)
        .json({ error: "Code must be exactly 3 characters (letters/numbers only)" });
    }

    const { rows } = await pool.query(
      `UPDATE location
       SET code = COALESCE($1, code), name = $2, d365_id = $3, address = $4, is_active = $5
       WHERE id = $6
       RETURNING id, code, name, d365_id, address, is_active, created_at`,
      [
        codeValue === null ? null : codeValue.toUpperCase(),
        String(name).trim(),
        String(d365Id).trim(),
        address,
        isActive,
        id,
      ]
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
