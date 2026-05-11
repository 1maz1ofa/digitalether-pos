import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";

function qtyFmt(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function InventoryPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalProduct, setModalProduct] = useState(null);
  const [breakdown, setBreakdown] = useState([]);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const summary = await api.inventory.stockSummary();
      setRows(summary);
    } catch (e) {
      setError(e.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const code = (r.product_code || "").toLowerCase();
      const name = (r.product_name || "").toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [rows, search]);

  async function openBreakdown(row) {
    setModalProduct(row);
    setBreakdown([]);
    setBreakdownError("");
    setBreakdownLoading(true);
    try {
      const stock = await api.inventory.stock({ productId: row.product_id });
      setBreakdown(stock);
    } catch (e) {
      setBreakdownError(e.message || "Failed to load locations");
    } finally {
      setBreakdownLoading(false);
    }
  }

  function closeBreakdown() {
    setModalProduct(null);
    setBreakdown([]);
    setBreakdownError("");
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Inventory</h1>
          <p className="page-lead">
            On-hand quantity per product across all locations. Click a quantity
            to see the location breakdown.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={load}
          disabled={loading}
        >
          Refresh
        </button>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="card">
        <div className="card-header-row">
          <h2 className="card-title">Products</h2>
          <div className="card-header-actions">
            <input
              className="input"
              type="search"
              placeholder="Search code or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: "16rem" }}
            />
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Product</th>
                  <th>UoM</th>
                  <th>Locations</th>
                  <th>Total quantity</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      {rows.length === 0
                        ? "No products yet."
                        : "No products match your search."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.product_id}>
                      <td>
                        {r.product_code ? <code>{r.product_code}</code> : "—"}
                      </td>
                      <td>{r.product_name || "—"}</td>
                      <td>{r.unit_of_measure || "—"}</td>
                      <td>{Number(r.location_count || 0)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => openBreakdown(r)}
                          title="Show per-location breakdown"
                        >
                          {qtyFmt(r.total_quantity)}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        title={
          modalProduct
            ? `Stock by location — ${modalProduct.product_name || modalProduct.product_code || "Product"}`
            : "Stock by location"
        }
        isOpen={Boolean(modalProduct)}
        onClose={closeBreakdown}
        footer={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={closeBreakdown}
          >
            Close
          </button>
        }
      >
        {breakdownError ? (
          <div className="alert alert-error" role="alert">
            {breakdownError}
          </div>
        ) : null}
        {breakdownLoading ? (
          <p className="muted">Loading…</p>
        ) : breakdown.length === 0 ? (
          <p className="muted">
            No stock recorded for this product in any location.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Quantity</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.location_code ? (
                        <code style={{ marginRight: "0.4rem" }}>
                          {r.location_code}
                        </code>
                      ) : null}
                      {r.location_name || "—"}
                    </td>
                    <td>{qtyFmt(r.quantity)}</td>
                    <td className="muted">
                      {r.updated_at
                        ? new Date(r.updated_at).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
