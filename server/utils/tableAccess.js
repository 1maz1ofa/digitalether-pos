const pool = require("../db");

/** Roles that may access all tables without explicit TABLE rights. */
const TABLE_BYPASS_ROLE_NAMES = new Set(["Super User", "Admin"]);

function roleBypassesTableRights(roleName) {
  return TABLE_BYPASS_ROLE_NAMES.has(String(roleName || "").trim());
}

function tableNameFromObjectName(objectName) {
  const s = String(objectName || "").trim();
  if (!s) return "";
  const dot = s.indexOf(".");
  return dot === -1 ? s : s.slice(0, dot);
}

function mergePermissionFlags(existing, next) {
  return {
    can_read: Boolean(existing?.can_read || next.can_read),
    can_create: Boolean(existing?.can_create || next.can_create),
    can_edit: Boolean(existing?.can_edit || next.can_edit),
    can_delete: Boolean(existing?.can_delete || next.can_delete),
  };
}

function buildTablePermissionIndex(rightRows) {
  const tables = {};
  for (const row of rightRows || []) {
    if (row.object_type !== "TABLE" && row.object_type !== "FIELD") continue;
    const tableName = tableNameFromObjectName(row.object_name);
    if (!tableName) continue;
    const next = {
      can_read: Boolean(row.can_read),
      can_create: Boolean(row.can_create),
      can_edit: Boolean(row.can_edit),
      can_delete: Boolean(row.can_delete),
    };
    tables[tableName] = tables[tableName]
      ? mergePermissionFlags(tables[tableName], next)
      : next;
  }
  return tables;
}

function getTablePermission(tableAccess, tableName) {
  const name = String(tableName || "").trim();
  if (!name) {
    return {
      can_read: false,
      can_create: false,
      can_edit: false,
      can_delete: false,
    };
  }
  if (!tableAccess || tableAccess.bypass) {
    return {
      can_read: true,
      can_create: true,
      can_edit: true,
      can_delete: true,
    };
  }
  const entry = tableAccess.tables?.[name];
  return {
    can_read: Boolean(entry?.can_read),
    can_create: Boolean(entry?.can_create),
    can_edit: Boolean(entry?.can_edit),
    can_delete: Boolean(entry?.can_delete),
  };
}

function httpMethodToAction(method) {
  switch (String(method || "").toUpperCase()) {
    case "GET":
    case "HEAD":
      return "read";
    case "POST":
      return "create";
    case "PUT":
    case "PATCH":
      return "edit";
    case "DELETE":
      return "delete";
    default:
      return null;
  }
}

function hasTablePermission(tableAccess, tableName, action) {
  const perms = getTablePermission(tableAccess, tableName);
  switch (action) {
    case "read":
      return perms.can_read;
    case "create":
      return perms.can_create;
    case "edit":
      return perms.can_edit;
    case "delete":
      return perms.can_delete;
    default:
      return false;
  }
}

async function loadTableRightsForRole(roleId) {
  const { rows } = await pool.query(
    `SELECT object_name, object_type, can_read, can_create, can_edit, can_delete
     FROM rights
     WHERE role_id = $1
       AND object_type IN ('TABLE', 'FIELD')`,
    [roleId]
  );
  return rows;
}

async function buildTableAccessForUser(user) {
  if (roleBypassesTableRights(user?.role_name)) {
    return { bypass: true, tables: {} };
  }
  const rows = await loadTableRightsForRole(user.role_id);
  return {
    bypass: false,
    tables: buildTablePermissionIndex(rows),
  };
}

module.exports = {
  TABLE_BYPASS_ROLE_NAMES,
  roleBypassesTableRights,
  tableNameFromObjectName,
  buildTablePermissionIndex,
  getTablePermission,
  httpMethodToAction,
  hasTablePermission,
  loadTableRightsForRole,
  buildTableAccessForUser,
};
