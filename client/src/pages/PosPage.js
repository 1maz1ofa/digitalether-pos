import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";

function money(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function cartKey(productId) {
  return String(productId);
}

export function PosPage() {
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [cart, setCart] = useState(() => new Map());
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [p, loc, cust] = await Promise.all([
        api.products.list(),
        api.locations.list(),
        api.customers.list(),
      ]);
      setProducts(p);
      setLocations(loc.filter((l) => l.is_active !== false));
      setCustomers(cust);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!locationId && locations.length) {
      setLocationId(String(locations[0].id));
    }
  }, [locations, locationId]);

  const activeProducts = useMemo(
    () => products.filter((p) => p.is_active && p.unit_price != null && Number(p.unit_price) >= 0),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeProducts;
    return activeProducts.filter((p) => {
      const hay = `${p.code || ""} ${p.name || ""} ${p.barcode || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [activeProducts, search]);

  const cartLines = useMemo(() => Array.from(cart.values()), [cart]);

  const subtotal = useMemo(
    () =>
      cartLines.reduce((sum, line) => {
        const price = Number(line.unit_price);
        const qty = Number(line.quantity);
        if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
        return sum + price * qty;
      }, 0),
    [cartLines]
  );

  function addToCart(product) {
    setLastReceipt(null);
    const key = cartKey(product.id);
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(key);
      const unitPrice = Number(product.unit_price);
      if (existing) {
        next.set(key, {
          ...existing,
          quantity: existing.quantity + 1,
        });
      } else {
        next.set(key, {
          product_id: product.id,
          code: product.code,
          name: product.name,
          unit_price: unitPrice,
          quantity: 1,
        });
      }
      return next;
    });
  }

  function setLineQuantity(productId, qty) {
    const key = cartKey(productId);
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      setCart((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    setCart((prev) => {
      const next = new Map(prev);
      const line = next.get(key);
      if (!line) return prev;
      next.set(key, { ...line, quantity: n });
      return next;
    });
  }

  function removeLine(productId) {
    setCart((prev) => {
      const next = new Map(prev);
      next.delete(cartKey(productId));
      return next;
    });
  }

  function clearCart() {
    setCart(new Map());
  }

  async function handleCheckout() {
    setError("");
    setLastReceipt(null);
    if (!locationId) {
      setError("Select a location.");
      return;
    }
    if (cartLines.length === 0) {
      setError("Add at least one item to the cart.");
      return;
    }
    setCheckoutLoading(true);
    try {
      const payload = {
        location_id: parseInt(locationId, 10),
        customer_id: customerId === "" ? null : parseInt(customerId, 10),
        items: cartLines.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
        })),
      };
      const result = await api.pos.checkout(payload);
      setLastReceipt(result);
      clearCart();
    } catch (e) {
      setError(e.message || "Checkout failed");
    } finally {
      setCheckoutLoading(false);
    }
  }

  return (
    <div className="page pos-page">
      <header className="page-header">
        <div>
          <h1>Point of sale</h1>
          <p className="page-lead">Ring up sales; totals use catalog prices at checkout.</p>
        </div>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      {lastReceipt ? (
        <div className="alert pos-receipt" role="status">
          <strong>Sale recorded.</strong> Invoice{" "}
          <code>{lastReceipt.invoice?.invoice_number}</code> — total{" "}
          {money(lastReceipt.invoice?.total)}
        </div>
      ) : null}

      <div className="pos-shell">
        <section className="card pos-catalog">
          <div className="pos-catalog-toolbar">
            <input
              className="input pos-search"
              type="search"
              placeholder="Search code, name, or barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search products"
            />
          </div>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="pos-product-grid">
              {filteredProducts.length === 0 ? (
                <p className="muted pos-grid-empty">No matching products with a price.</p>
              ) : (
                filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="pos-product-tile"
                    onClick={() => addToCart(p)}
                  >
                    <span className="pos-product-name">{p.name}</span>
                    <span className="pos-product-meta">
                      <code>{p.code}</code>
                      <span className="pos-product-price">{money(p.unit_price)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </section>

        <aside className="card pos-cart">
          <h2 className="pos-cart-title">Current sale</h2>
          <label className="field">
            <span className="field-label">Location</span>
            <select
              className="input"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">— Select —</option>
              {locations.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.name || l.code || `Location #${l.id}`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Customer (optional)</span>
            <select
              className="input"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Walk-in</option>
              {customers.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name || `Customer #${c.id}`}
                </option>
              ))}
            </select>
          </label>

          <div className="pos-cart-lines">
            {cartLines.length === 0 ? (
              <p className="muted">Cart is empty. Tap a product to add.</p>
            ) : (
              cartLines.map((line) => (
                <div key={line.product_id} className="pos-line">
                  <div className="pos-line-info">
                    <div className="pos-line-name">{line.name}</div>
                    <div className="pos-line-sub">
                      <code>{line.code}</code> × {money(line.unit_price)}
                    </div>
                  </div>
                  <div className="pos-line-actions">
                    <input
                      className="input pos-qty"
                      type="number"
                      min="1"
                      step="1"
                      value={line.quantity}
                      onChange={(e) => setLineQuantity(line.product_id, e.target.value)}
                      aria-label={`Quantity for ${line.name}`}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeLine(line.product_id)}
                      aria-label={`Remove ${line.name}`}
                    >
                      ×
                    </button>
                  </div>
                  <div className="pos-line-total">{money(line.quantity * line.unit_price)}</div>
                </div>
              ))
            )}
          </div>

          <div className="pos-cart-footer">
            <div className="pos-subtotal">
              <span>Subtotal</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <div className="pos-cart-buttons">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={cartLines.length === 0 || checkoutLoading}
                onClick={clearCart}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn btn-primary pos-pay"
                disabled={
                  !locationId || cartLines.length === 0 || checkoutLoading || loading
                }
                onClick={handleCheckout}
              >
                {checkoutLoading ? "Processing…" : "Complete sale"}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
