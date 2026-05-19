const pool = require("../db");
const { verifyToken } = require("../utils/authToken");
const { buildMenuAccessForUser } = require("../utils/menuAccess");
const { buildTableAccessForUser } = require("../utils/tableAccess");

const USER_SELECT = `
  SELECT u.id, u.email, u.full_name, u.role_id, u.location_id, u.is_active,
         r.name AS role_name,
         l.code AS location_code, l.name AS location_name
  FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN location l ON l.id = u.location_id`;

function locationLabel(row) {
  if (!row) return "—";
  if (row.location_id == null) return "ALL";
  const code = row.location_code ? String(row.location_code).trim() : "";
  const name = row.location_name ? String(row.location_name).trim() : "";
  if (code && name) return `${code} — ${name}`;
  return code || name || "—";
}

function readBearerToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return null;
}

async function loadUser(userId) {
  const { rows } = await pool.query(`${USER_SELECT} WHERE u.id = $1`, [userId]);
  if (!rows.length) return null;
  const row = rows[0];
  if (!row.is_active) return null;
  const [menu_access, table_access] = await Promise.all([
    buildMenuAccessForUser(row),
    buildTableAccessForUser(row),
  ]);
  return { ...row, location_label: locationLabel(row), menu_access, table_access };
}

async function requireAuth(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const userId = verifyToken(token);
    if (!userId) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    const user = await loadUser(userId);
    if (!user) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }
    req.user = user;
    req.authToken = token;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).json({ error: "Authentication failed" });
  }
}

function isPublicApiRequest(req) {
  if (req.method === "GET" && req.path === "/health") return true;
  if (req.method === "POST" && req.path === "/auth/login") return true;
  return false;
}

module.exports = { requireAuth, isPublicApiRequest, loadUser, locationLabel, USER_SELECT };
