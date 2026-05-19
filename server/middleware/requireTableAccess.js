const {
  httpMethodToAction,
  hasTablePermission,
} = require("../utils/tableAccess");

function requireTableAccess(tableName) {
  const table = String(tableName || "").trim();
  return (req, res, next) => {
    const action = httpMethodToAction(req.method);
    if (!action) return next();
    if (!table) {
      return res.status(500).json({ error: "Table access is not configured" });
    }
    if (!hasTablePermission(req.user?.table_access, table, action)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };
}

module.exports = { requireTableAccess };
