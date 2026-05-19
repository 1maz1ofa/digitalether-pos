const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");
const { APP_MENU, isValidMenuObjectName } = require("../config/appMenu");

const router = express.Router();

const RIGHT_COLUMNS =
  "id, role_id, object_name, object_type, can_read, can_edit, can_delete, created_at";

const OBJECT_TYPES = new Set(["TABLE", "FIELD", "MENU", "SUBMENU"]);

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function isValidIdent(name) {
  return typeof name === "string" && IDENT_RE.test(name);
}

function parseRoleId(val) {
  const n = Number.parseInt(val, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseRightBody(body, { requireRoleId = false } = {}) {
  const roleIdRaw = body?.role_id ?? body?.roleId;
  const role_id = parseRoleId(roleIdRaw);
  if (requireRoleId && !role_id) {
    return { error: "role_id is required" };
  }

  const objectNameRaw = body?.object_name ?? body?.objectName;
  if (
    objectNameRaw === undefined ||
    objectNameRaw === null ||
    String(objectNameRaw).trim() === ""
  ) {
    return { error: "object_name is required" };
  }
  const object_name = String(objectNameRaw).trim();

  const objectTypeRaw = body?.object_type ?? body?.objectType;
  const object_type = String(objectTypeRaw || "")
    .trim()
    .toUpperCase();
  if (!OBJECT_TYPES.has(object_type)) {
    return {
      error: "object_type must be TABLE, FIELD, MENU, or SUBMENU",
    };
  }

  if (
    (object_type === "MENU" || object_type === "SUBMENU") &&
    !isValidMenuObjectName(object_name, object_type)
  ) {
    return { error: "Invalid menu or sub menu" };
  }

  const can_read = Boolean(body?.can_read ?? body?.canRead);
  let can_edit = Boolean(body?.can_edit ?? body?.canEdit);
  let can_delete = Boolean(body?.can_delete ?? body?.canDelete);
  if (object_type === "MENU" || object_type === "SUBMENU") {
    can_edit = false;
    can_delete = false;
  }

  return {
    role_id,
    object_name,
    object_type,
    can_read,
    can_edit,
    can_delete,
  };
}

router.get("/schema/menus", async (_req, res) => {
  res.json(APP_MENU);
});

router.get("/schema/tables", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    res.json(rows.map((r) => r.table_name));
  } catch (err) {
    sendPgError(res, err);
  }
});

router.get("/schema/tables/:table/columns", async (req, res) => {
  try {
    const table = String(req.params.table || "").trim();
    if (!isValidIdent(table)) {
      return res.status(400).json({ error: "Invalid table name" });
    }
    const { rows } = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );
    res.json(rows.map((r) => r.column_name));
  } catch (err) {
    sendPgError(res, err);
  }
});

router.get("/", async (req, res) => {
  try {
    const roleId = parseRoleId(req.query.role_id ?? req.query.roleId);
    const params = [];
    let where = "";
    if (roleId) {
      where = " WHERE role_id = $1";
      params.push(roleId);
    }
    const { rows } = await pool.query(
      `SELECT ${RIGHT_COLUMNS}
       FROM rights${where}
       ORDER BY object_type, object_name NULLS LAST, id`,
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
      `SELECT ${RIGHT_COLUMNS} FROM rights WHERE id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Right not found" });
    res.json(rows[0]);
  } catch (err) {
    sendPgError(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    const parsed = parseRightBody(req.body, { requireRoleId: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const roleChk = await pool.query("SELECT 1 FROM roles WHERE id = $1", [
      parsed.role_id,
    ]);
    if (!roleChk.rowCount) {
      return res.status(400).json({ error: "Role not found" });
    }

    const { rows } = await pool.query(
      `INSERT INTO rights (
         role_id, object_name, object_type, can_read, can_edit, can_delete
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${RIGHT_COLUMNS}`,
      [
        parsed.role_id,
        parsed.object_name,
        parsed.object_type,
        parsed.can_read,
        parsed.can_edit,
        parsed.can_delete,
      ]
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
    const parsed = parseRightBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { rows } = await pool.query(
      `UPDATE rights
       SET object_name = $1,
           object_type = $2,
           can_read = $3,
           can_edit = $4,
           can_delete = $5
       WHERE id = $6
       RETURNING ${RIGHT_COLUMNS}`,
      [
        parsed.object_name,
        parsed.object_type,
        parsed.can_read,
        parsed.can_edit,
        parsed.can_delete,
        id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: "Right not found" });
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
    const { rowCount } = await pool.query("DELETE FROM rights WHERE id = $1", [
      id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Right not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
