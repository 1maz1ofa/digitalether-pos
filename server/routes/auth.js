const express = require("express");
const pool = require("../db");
const { sendPgError } = require("../utils/dbErrors");
const { verifyPassword } = require("../utils/password");
const { signToken } = require("../utils/authToken");
const { requireAuth, locationLabel } = require("../middleware/requireAuth");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = req.body?.password;

    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!password) return res.status(400).json({ error: "Password is required" });

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.full_name, u.role_id, u.location_id, u.is_active,
              r.name AS role_name,
              l.code AS location_code, l.name AS location_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN location l ON l.id = u.location_id
       WHERE LOWER(u.email) = $1`,
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const row = rows[0];
    if (!row.is_active) {
      return res.status(403).json({ error: "Account is disabled" });
    }

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(row.id);
    const { password_hash: _removed, ...user } = row;
    res.json({
      token,
      user: { ...user, location_label: locationLabel(user) },
    });
  } catch (err) {
    sendPgError(res, err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post("/logout", requireAuth, (_req, res) => {
  res.status(204).send();
});

module.exports = router;
