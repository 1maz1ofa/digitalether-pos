/**
 * Application menu catalog for menu-level permissions.
 * Top-level entries match main navigation items; optional `children` are sub menus.
 */
const APP_MENU = [
  { id: "pos", label: "POS", path: "/pos" },
  {
    id: "configurations",
    label: "Configurations",
    path: "/vat",
    children: [
      { id: "vat", label: "VAT", path: "/vat" },
      {
        id: "movement-types",
        label: "Movement types",
        path: "/movement-types",
      },
      { id: "currencies", label: "Currencies", path: "/currencies" },
      { id: "categories", label: "Categories", path: "/categories" },
      { id: "locations", label: "Locations", path: "/locations" },
    ],
  },
  {
    id: "user-management",
    label: "User management",
    path: "/users",
    children: [
      { id: "users", label: "Users", path: "/users" },
      { id: "roles", label: "Roles", path: "/roles" },
    ],
  },
  {
    id: "product-management",
    label: "Product Management",
    path: "/products",
    children: [
      {
        id: "products",
        label: "Products",
        path: "/products",
        children: [
          {
            id: "product-detail",
            label: "Product detail",
            path: "/products/:id",
          },
        ],
      },
      {
        id: "inventory",
        label: "Inventory",
        path: "/inventory",
        children: [
          {
            id: "product-locations",
            label: "Product locations",
            path: "/inventory/product/:productId",
          },
        ],
      },
      {
        id: "stocktakes",
        label: "Stock Take",
        path: "/stocktakes",
        children: [
          {
            id: "stocktake-new",
            label: "New stock take",
            path: "/stocktakes/new",
          },
          {
            id: "stocktake-detail",
            label: "Stock take detail",
            path: "/stocktakes/:id",
          },
        ],
      },
      {
        id: "movement",
        label: "Movement",
        path: "/movement",
        children: [
          {
            id: "movement-new",
            label: "New movement",
            path: "/movement/new",
          },
        ],
      },
      { id: "promises", label: "Promises", path: "/promises" },
      {
        id: "reserve-issue",
        label: "Reserve Issues",
        path: "/reserve-issue",
      },
    ],
  },
  {
    id: "sales-management",
    label: "Sales Management",
    path: "/customers",
    children: [
      { id: "customers", label: "Customers", path: "/customers" },
      { id: "invoices", label: "Invoices", path: "/invoices" },
    ],
  },
];

function findMenuItem(menuId) {
  function search(items) {
    for (const item of items) {
      if (item.id === menuId) return item;
      if (item.children?.length) {
        const found = search(item.children);
        if (found) return found;
      }
    }
    return null;
  }
  return search(APP_MENU);
}

function findSubMenu(menuId, subMenuId) {
  const item = findMenuItem(menuId);
  if (!item?.children?.length) return null;
  return item.children.find((c) => c.id === subMenuId) || null;
}

function isValidMenuObjectName(objectName, objectType) {
  const name = String(objectName || "").trim();
  if (!name) return false;
  const dot = name.indexOf(".");
  const menuId = dot === -1 ? name : name.slice(0, dot);
  const subId = dot === -1 ? "" : name.slice(dot + 1);
  const item = findMenuItem(menuId);
  if (!item) return false;
  if (objectType === "MENU") {
    return dot === -1;
  }
  if (objectType === "SUBMENU") {
    return dot !== -1 && Boolean(findSubMenu(menuId, subId));
  }
  return false;
}

module.exports = {
  APP_MENU,
  findMenuItem,
  findSubMenu,
  isValidMenuObjectName,
};
