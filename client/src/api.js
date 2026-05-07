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
    const err = new Error(body?.error || res.statusText || "Request failed");
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
  products: {
    list: () => apiRequest("/api/products"),
    get: (id) => apiRequest(`/api/products/${id}`),
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
    settings: () => apiRequest("/api/pos/settings"),
    paymentMethods: () => apiRequest("/api/pos/payment-methods"),
    saleTypes: () => apiRequest("/api/pos/sale-types"),
    checkout: (data) =>
      apiRequest("/api/pos/checkout", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  },
  d365: {
    finalApprovedCreditApplications: (top = 200) =>
      apiRequest(
        `/api/d365/credit-applications/final-approved?top=${encodeURIComponent(String(top))}`
      ),
  },
};
