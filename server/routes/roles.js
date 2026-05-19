const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");
const { requireTableAccess } = require("../middleware/requireTableAccess");

const router = express.Router();
router.use(requireTableAccess("roles"));

const ROLE_COLUMNS = "id, name, description, created_at";

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ROLE_COLUMNS}
       FROM roles
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
      `SELECT ${ROLE_COLUMNS} FROM roles WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Role not found" });
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

function parseRoleBody(body) {
  const name = body?.name;
  if (name === undefined || name === null || String(name).trim() === "") {
    return { error: "Name is required" };
  }
  const trimmedName = String(name).trim();
  if (trimmedName.length > 30) {
    return { error: "Name must be at most 30 characters" };
  }
  const descriptionRaw = body?.description;
  const description =
    descriptionRaw === undefined || descriptionRaw === null
      ? null
      : String(descriptionRaw).trim() || null;
  return { name: trimmedName, description };
}

router.post("/", async (req, res) => {
  try {
    const parsed = parseRoleBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { rows } = await pool.query(
      `INSERT INTO roles (name, description)
       VALUES ($1, $2)
       RETURNING ${ROLE_COLUMNS}`,
      [parsed.name, parsed.description]
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
    const parsed = parseRoleBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { rows } = await pool.query(
      `UPDATE roles
       SET name = $1, description = $2
       WHERE id = $3
       RETURNING ${ROLE_COLUMNS}`,
      [parsed.name, parsed.description, id]
    );
    if (!rows.length) return res.status(404).json({ error: "Role not found" });
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
    const { rowCount } = await pool.query("DELETE FROM roles WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "Role not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
