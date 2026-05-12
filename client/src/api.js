const API_BASE = "";

async function parseJsonSafe(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Invalid response" };
  }
}

export async function apiRequest(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { "Content-Type": "application/json", ...options.headers };
  const res = await fetch(url, { ...options, headers });
  const body = res.status === 204 ? null : await parseJsonSafe(res);
  if (!res.ok) {
    const message =
      body?.error && body?.detail
        ? `${body.error} (${body.detail})`
        : body?.error || res.statusText || "Request failed";
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export const api = {
  categories: {
    list: () => apiRequest("/api/categories"),
    get: (id) => apiRequest(`/api/categories/${id}`),
    create: (data) =>
      apiRequest("/api/categories", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/categories/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (id) =>
      apiRequest(`/api/categories/${id}`, { method: "DELETE" }),
  },
  locations: {
    list: () => apiRequest("/api/locations"),
    get: (id) => apiRequest(`/api/locations/${id}`),
    create: (data) =>
      apiRequest("/api/locations", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/locations/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (id) =>
      apiRequest(`/api/locations/${id}`, { method: "DELETE" }),
  },
  terminals: {
    list: () => apiRequest("/api/terminals"),
    get: (id) => apiRequest(`/api/terminals/${id}`),
    create: (data) =>
      apiRequest("/api/terminals", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/terminals/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (id) =>
      apiRequest(`/api/terminals/${id}`, { method: "DELETE" }),
  },
  products: {
    list: () => apiRequest("/api/products"),
    get: (id) => apiRequest(`/api/products/${id}`),
    inventoryLocations: (id) =>
      apiRequest(`/api/products/${encodeURIComponent(String(id))}/inventory-locations`),
    create: (data) =>
      apiRequest("/api/products", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/products/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (id) =>
      apiRequest(`/api/products/${id}`, { method: "DELETE" }),
  },
  customers: {
    list: () => apiRequest("/api/customers"),
    get: (id) => apiRequest(`/api/customers/${id}`),
    create: (data) =>
      apiRequest("/api/customers", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/customers/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (id) =>
      apiRequest(`/api/customers/${id}`, { method: "DELETE" }),
  },
  invoices: {
    list: (fromDate, toDate, saleTypeId) => {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", String(fromDate));
      if (toDate) params.set("to", String(toDate));
      if (saleTypeId !== null && saleTypeId !== undefined && String(saleTypeId).trim() !== "") {
        params.set("saleTypeId", String(saleTypeId));
      }
      const q = params.toString() ? `?${params.toString()}` : "";
      return apiRequest(`/api/invoices${q}`);
    },
  },
  currencies: {
    list: () => apiRequest("/api/currencies"),
    get: (id) => apiRequest(`/api/currencies/${id}`),
    create: (data) =>
      apiRequest("/api/currencies", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/currencies/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (id) =>
      apiRequest(`/api/currencies/${id}`, { method: "DELETE" }),
  },
  vat: {
    list: () => apiRequest("/api/vat"),
    get: (id) => apiRequest(`/api/vat/${id}`),
    create: (data) =>
      apiRequest("/api/vat", { method: "POST", body: JSON.stringify(data) }),
    update: (id, data) =>
      apiRequest(`/api/vat/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    remove: (id) => apiRequest(`/api/vat/${id}`, { method: "DELETE" }),
  },
  pos: {
    settings: (opts = {}) => {
      const params = new URLSearchParams();
      const loc = opts.locationId ?? opts.location_id;
      const term = opts.terminalId ?? opts.terminal_id;
      if (loc != null && String(loc).trim() !== "") params.set("location_id", String(loc).trim());
      if (term != null && String(term).trim() !== "") params.set("terminal_id", String(term).trim());
      const q = params.toString();
      return apiRequest(`/api/pos/settings${q ? `?${q}` : ""}`);
    },
    paymentMethods: () => apiRequest("/api/pos/payment-methods"),
    saleTypes: () => apiRequest("/api/pos/sale-types"),
    checkout: (data, opts = {}) => {
      const headers = {};
      if (opts.profile) {
        headers["X-POS-Checkout-Profile"] = "1";
      }
      return apiRequest("/api/pos/checkout", {
        method: "POST",
        body: JSON.stringify(data),
        headers,
      });
    },
  },
  d365: {
    finalApprovedCreditApplications: (top = 200, opts = {}) => {
      const params = new URLSearchParams();
      params.set("top", String(top));
      const branch =
        opts.branchD365Id ?? opts.branch_d365_id ?? null;
      if (branch != null && String(branch).trim() !== "") {
        params.set("branch_d365_id", String(branch).trim());
      }
      return apiRequest(
        `/api/d365/credit-applications/final-approved?${params.toString()}`
      );
    },
  },
  inventory: {
    movementTypes: () => apiRequest("/api/inventory/movement-types"),
    createMovementType: (data) =>
      apiRequest("/api/inventory/movement-types", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateMovementType: (id, data) =>
      apiRequest(`/api/inventory/movement-types/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    removeMovementType: (id) =>
      apiRequest(`/api/inventory/movement-types/${id}`, { method: "DELETE" }),
    stock: (locationIdOrOptions) => {
      let locationId = null;
      let productId = null;
      if (locationIdOrOptions && typeof locationIdOrOptions === "object") {
        locationId = locationIdOrOptions.locationId ?? null;
        productId = locationIdOrOptions.productId ?? null;
      } else {
        locationId = locationIdOrOptions;
      }
      const params = new URLSearchParams();
      if (
        locationId !== null &&
        locationId !== undefined &&
        String(locationId).trim() !== ""
      ) {
        params.set("location_id", String(locationId));
      }
      if (
        productId !== null &&
        productId !== undefined &&
        String(productId).trim() !== ""
      ) {
        params.set("product_id", String(productId));
      }
      const q = params.toString() ? `?${params.toString()}` : "";
      return apiRequest(`/api/inventory/stock${q}`);
    },
    stockSummary: () => apiRequest("/api/inventory/stock/summary"),
    movements: (limit = 100) =>
      apiRequest(
        `/api/inventory/movements?limit=${encodeURIComponent(String(limit))}`
      ),
    postMovement: (data) =>
      apiRequest("/api/inventory/movements", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    promises: {
      list: ({ fromLocationId, productId } = {}) => {
        const params = new URLSearchParams();
        const id =
          fromLocationId !== null && fromLocationId !== undefined
            ? String(fromLocationId).trim()
            : "";
        if (id) params.set("from_location_id", id);
        if (
          productId !== null &&
          productId !== undefined &&
          String(productId).trim() !== ""
        ) {
          params.set("product_id", String(productId).trim());
        }
        const q = params.toString() ? `?${params.toString()}` : "";
        return apiRequest(`/api/inventory/promises${q}`);
      },
      create: (data) =>
        apiRequest("/api/inventory/promises", {
          method: "POST",
          body: JSON.stringify(data),
        }),
    },
  },
};
