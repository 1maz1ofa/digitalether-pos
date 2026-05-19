const { APP_MENU } = require("../config/appMenu");
const pool = require("../db");

/** Roles that may access all menus without explicit MENU/SUBMENU rights. */
const MENU_BYPASS_ROLE_NAMES = new Set(["Super User", "Admin"]);

function roleBypassesMenuRights(roleName) {
  return MENU_BYPASS_ROLE_NAMES.has(String(roleName || "").trim());
}

function pathPatternToRegex(pattern) {
  const parts = String(pattern || "")
    .split("/")
    .filter((p, i) => i > 0 || p !== "");
  const reParts = parts.map((seg) =>
    seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(`^/${reParts.join("/")}$`);
}

/**
 * Flatten menu tree with top-level menu id and direct sub-menu id (first level under top).
 */
function flattenMenuEntries(items, topMenuId = null, directSubMenuId = null) {
  const out = [];
  for (const item of items) {
    const isRoot = topMenuId === null;
    const nextTop = isRoot ? item.id : topMenuId;
    const nextDirect = isRoot ? null : directSubMenuId || item.id;

    out.push({
      id: item.id,
      path: item.path,
      topMenuId: nextTop,
      directSubMenuId: isRoot ? null : nextDirect,
    });

    if (item.children?.length) {
      out.push(
        ...flattenMenuEntries(
          item.children,
          nextTop,
          isRoot ? null : nextDirect
        )
      );
    }
  }
  return out;
}

const FLAT_MENU_ENTRIES = flattenMenuEntries(APP_MENU);

function menuEntryMatchScore(entry) {
  const pathLen = String(entry.path || "").length;
  const specificity = entry.directSubMenuId ? 1 : 0;
  return pathLen * 10 + specificity;
}

function findMenuEntryForPath(pathname) {
  const path = String(pathname || "").split("?")[0] || "/";
  let best = null;
  let bestScore = -1;
  for (const entry of FLAT_MENU_ENTRIES) {
    if (!entry.path) continue;
    const re = pathPatternToRegex(entry.path);
    if (!re.test(path)) continue;
    const score = menuEntryMatchScore(entry);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return best;
}

function buildMenuPermissionIndex(rightRows) {
  const menus = new Set();
  const submenus = new Set();
  for (const row of rightRows || []) {
    if (!row.can_read) continue;
    const name = String(row.object_name || "").trim();
    if (!name) continue;
    if (row.object_type === "MENU") menus.add(name);
    if (row.object_type === "SUBMENU") submenus.add(name);
  }
  return { menus, submenus };
}

function menuSets(menuAccess) {
  const menus =
    menuAccess.menus instanceof Set
      ? menuAccess.menus
      : new Set(menuAccess.menus || []);
  const submenus =
    menuAccess.submenus instanceof Set
      ? menuAccess.submenus
      : new Set(menuAccess.submenus || []);
  return { menus, submenus };
}

function hasMenuPermission(menuAccess, topMenuId, directSubMenuId) {
  if (!menuAccess || menuAccess.bypass) return true;
  if (!topMenuId) return false;
  const { menus, submenus } = menuSets(menuAccess);
  if (menus.has(topMenuId)) return true;
  if (directSubMenuId && directSubMenuId !== topMenuId) {
    if (submenus.has(`${topMenuId}.${directSubMenuId}`)) return true;
  }
  return false;
}

function canAccessPath(pathname, menuAccess) {
  if (!menuAccess) return false;
  if (menuAccess.bypass) return true;
  const entry = findMenuEntryForPath(pathname);
  if (!entry) return true;
  return hasMenuPermission(
    menuAccess,
    entry.topMenuId,
    entry.directSubMenuId
  );
}

async function loadMenuRightsForRole(roleId) {
  const { rows } = await pool.query(
    `SELECT object_name, object_type, can_read
     FROM rights
     WHERE role_id = $1
       AND object_type IN ('MENU', 'SUBMENU')
       AND can_read = true`,
    [roleId]
  );
  return rows;
}

async function buildMenuAccessForUser(user) {
  if (roleBypassesMenuRights(user?.role_name)) {
    return { bypass: true, menus: [], submenus: [] };
  }
  const rows = await loadMenuRightsForRole(user.role_id);
  const index = buildMenuPermissionIndex(rows);
  return {
    bypass: false,
    menus: [...index.menus],
    submenus: [...index.submenus],
  };
}

function firstAllowedPath(menuAccess) {
  if (!menuAccess) return null;
  if (menuAccess.bypass) return "/pos";
  for (const entry of FLAT_MENU_ENTRIES) {
    if (
      entry.path &&
      hasMenuPermission(menuAccess, entry.topMenuId, entry.directSubMenuId)
    ) {
      return entry.path.replace(/:[^/]+/g, "").replace(/\/$/, "") || entry.path;
    }
  }
  return null;
}

module.exports = {
  MENU_BYPASS_ROLE_NAMES,
  roleBypassesMenuRights,
  flattenMenuEntries,
  findMenuEntryForPath,
  buildMenuPermissionIndex,
  hasMenuPermission,
  canAccessPath,
  loadMenuRightsForRole,
  buildMenuAccessForUser,
  firstAllowedPath,
  FLAT_MENU_ENTRIES,
};
