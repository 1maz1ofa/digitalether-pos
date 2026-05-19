/** Roles that may access all menus without explicit MENU/SUBMENU rights. */
const MENU_BYPASS_ROLE_NAMES = new Set(["Super User", "Admin"]);

export function roleBypassesMenuRights(roleName) {
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

function menuAccessIndex(menuAccess) {
  if (!menuAccess || menuAccess.bypass) {
    return { bypass: true, menus: new Set(), submenus: new Set() };
  }
  return {
    bypass: false,
    menus: new Set(menuAccess.menus || []),
    submenus: new Set(menuAccess.submenus || []),
  };
}

export function hasMenuPermission(menuAccess, topMenuId, directSubMenuId) {
  const index = menuAccessIndex(menuAccess);
  if (index.bypass) return true;
  if (!topMenuId) return false;
  if (index.menus.has(topMenuId)) return true;
  if (directSubMenuId && directSubMenuId !== topMenuId) {
    if (index.submenus.has(`${topMenuId}.${directSubMenuId}`)) return true;
  }
  return false;
}

export function canAccessNavItem(menuAccess, menuId, parentMenuId) {
  if (!menuAccess) return false;
  if (menuAccess.bypass) return true;
  if (parentMenuId) {
    return hasMenuPermission(menuAccess, parentMenuId, menuId);
  }
  return hasMenuPermission(menuAccess, menuId, null);
}

let flatEntriesCache = null;

export function setMenuCatalog(catalog) {
  flatEntriesCache = Array.isArray(catalog)
    ? flattenMenuEntries(catalog)
    : null;
}

function getFlatEntries() {
  return flatEntriesCache || [];
}

function menuEntryMatchScore(entry) {
  const pathLen = String(entry.path || "").length;
  const specificity = entry.directSubMenuId ? 1 : 0;
  return pathLen * 10 + specificity;
}

export function findMenuEntryForPath(pathname) {
  const path = String(pathname || "").split("?")[0] || "/";
  let best = null;
  let bestScore = -1;
  for (const entry of getFlatEntries()) {
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

export function canAccessPath(pathname, menuAccess) {
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

export function firstAllowedPath(menuAccess) {
  if (!menuAccess) return null;
  if (menuAccess.bypass) return "/pos";
  for (const entry of getFlatEntries()) {
    if (
      entry.path &&
      hasMenuPermission(menuAccess, entry.topMenuId, entry.directSubMenuId)
    ) {
      const p = entry.path.replace(/:[^/]+/g, "");
      return p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p || entry.path;
    }
  }
  return null;
}
