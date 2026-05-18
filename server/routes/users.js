const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");
const { hashPassword } = require("../utils/password");

const router = express.Router();

const USER_SELECT = `
  SELECT u.id, u.email, u.full_name, u.role_id, u.location_id, u.is_active,
         u.created_at, u.updated_at,
         r.name AS role_name,
         l.code AS location_code, l.name AS location_name
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN location l ON l.id = u.location_id`;

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value)
  );
}

function parsePositiveInt(value, fieldName) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < 1) {
    return { error: `Invalid ${fieldName}` };
  }
  return { value: n };
}

/** null = all locations; number = single branch */
function parseLocationId(value) {
  if (value === null || value === undefined) {
    return { value: null };
  }
  const text = String(value).trim();
  if (text === "" || text.toLowerCase() === "all") {
    return { value: null };
  }
  return parsePositiveInt(value, "location_id");
}

function locationLabel(row) {
  if (!row) return "—";
  if (row.location_id == null) return "ALL";
  const code = row.location_code ? String(row.location_code).trim() : "";
  const name = row.location_name ? String(row.location_name).trim() : "";
  if (code && name) return `${code} — ${name}`;
  return code || name || "—";
}

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${USER_SELECT}
       ORDER BY u.full_name NULLS LAST, u.email`
    );
    res.json(
      rows.map((row) => ({
        ...row,
        location_label: locationLabel(row),
      }))
    );
  } catch (err) {
    sendPgError(res, err);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidUuid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const { rows } = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const row = rows[0];
    res.json({ ...row, location_label: locationLabel(row) });
  } catch (err) {
    sendPgError(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const fullName = String(req.body?.full_name || "").trim();
    const password = req.body?.password;
    const roleParsed = parsePositiveInt(req.body?.role_id, "role_id");
    const locationParsed = parseLocationId(req.body?.location_id);
    const isActive =
      req.body?.is_active === undefined ? true : Boolean(req.body.is_active);

    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!fullName) return res.status(400).json({ error: "Full name is required" });
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    if (roleParsed.error) return res.status(400).json({ error: roleParsed.error });
    if (locationParsed.error) {
      return res.status(400).json({ error: locationParsed.error });
    }

    const passwordHash = await hashPassword(password);

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role_id, location_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [email, passwordHash, fullName, roleParsed.value, locationParsed.value, isActive]
    );

    const { rows: created } = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [
      rows[0].id,
    ]);
    const row = created[0];
    res.status(201).json({ ...row, location_label: locationLabel(row) });
  } catch (err) {
    sendPgError(res, err);
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidUuid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const email = String(req.body?.email || "").trim().toLowerCase();
    const fullName = String(req.body?.full_name || "").trim();
    const password = req.body?.password;
    const roleParsed = parsePositiveInt(req.body?.role_id, "role_id");
    const locationParsed = parseLocationId(req.body?.location_id);
    const isActive = Boolean(req.body?.is_active);

    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!fullName) return res.status(400).json({ error: "Full name is required" });
    if (roleParsed.error) return res.status(400).json({ error: roleParsed.error });
    if (locationParsed.error) {
      return res.status(400).json({ error: locationParsed.error });
    }

    let passwordHash = null;
    if (password !== undefined && password !== null && String(password).trim() !== "") {
      if (String(password).length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      passwordHash = await hashPassword(password);
    }

    const { rows } = passwordHash
      ? await pool.query(
          `UPDATE users
           SET email = $1, full_name = $2, role_id = $3, location_id = $4,
               is_active = $5, password_hash = $6, updated_at = CURRENT_TIMESTAMP
           WHERE id = $7
           RETURNING id`,
          [
            email,
            fullName,
            roleParsed.value,
            locationParsed.value,
            isActive,
            passwordHash,
            id,
          ]
        )
      : await pool.query(
          `UPDATE users
           SET email = $1, full_name = $2, role_id = $3, location_id = $4,
               is_active = $5, updated_at = CURRENT_TIMESTAMP
           WHERE id = $6
           RETURNING id`,
          [email, fullName, roleParsed.value, locationParsed.value, isActive, id]
        );
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    const { rows: updated } = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [id]);
    const row = updated[0];
    res.json({ ...row, location_label: locationLabel(row) });
  } catch (err) {
    sendPgError(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidUuid(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }
    const { rowCount } = await pool.query("DELETE FROM users WHERE id = $1", [id]);
    if (!rowCount) return res.status(404).json({ error: "User not found" });
    res.status(204).send();
  } catch (err) {
    sendPgError(res, err);
  }
});

module.exports = router;
