/**
 * Table rights granted automatically when a role receives menu read access.
 * Keys are top-level menu ids from APP_MENU (see appMenu.js).
 *
 * POS loads data via table-protected APIs (products, inventory, etc.) and
 * checkout writes invoices, inventory, promises, and related rows.
 */
const MENU_TABLE_RIGHTS = {
  pos: [
    { table: "product", can_read: true },
    { table: "location", can_read: true },
    { table: "customers", can_read: true, can_create: true },
    { table: "terminal", can_read: true, can_edit: true },
    { table: "currency", can_read: true },
    { table: "inventory", can_read: true, can_create: true, can_edit: true },
    { table: "inventory_promise", can_read: true, can_edit: true },
    { table: "inventory_movement", can_read: true, can_create: true },
    { table: "movement_type", can_read: true, can_create: true },
    { table: "invoices", can_read: true, can_create: true },
    { table: "reserve_issue_header", can_read: true, can_create: true },
  ],
};

function menuIdFromRight(objectName, objectType) {
  const name = String(objectName || "").trim();
  if (!name) return null;
  if (objectType === "MENU") return name;
  if (objectType === "SUBMENU") {
    const dot = name.indexOf(".");
    return dot === -1 ? name : name.slice(0, dot);
  }
  return null;
}

function tableRightsForMenu(menuId) {
  return MENU_TABLE_RIGHTS[String(menuId || "").trim()] || null;
}

module.exports = {
  MENU_TABLE_RIGHTS,
  menuIdFromRight,
  tableRightsForMenu,
};
