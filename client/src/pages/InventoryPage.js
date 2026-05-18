import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { getUserLocationId } from "../utils/userLocation";

function qtyFmt(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function InventoryPage() {
  const { user } = useAuth();
  const userLocationId = useMemo(() => getUserLocationId(user), [user]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const summary = await api.inventory.stockSummary(userLocationId ?? undefined);
      setRows(summary);
    } catch (e) {
      setError(e.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [userLocationId]);

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

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Inventory</h1>
          <p className="page-lead">
            {userLocationId != null
              ? "Stock on hand per product at your branch. Click a quantity to see reserved and promised amounts by location."
              : "Stock on hand per product across all locations. Click a quantity to see reserved and promised amounts by location."}
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
                  <th>Stock on hand</th>
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
                  filtered.map((r) => {
                    const stock =
                      Number(r.stock_on_hand ?? r.total_quantity ?? 0) || 0;
                    return (
                    <tr key={r.product_id}>
                      <td>
                        {r.product_code ? <code>{r.product_code}</code> : "—"}
                      </td>
                      <td>{r.product_name || "—"}</td>
                      <td>{r.unit_of_measure || "—"}</td>
                      <td>
                        {stock > 0 ? Number(r.location_count || 0) : "—"}
                      </td>
                      <td>
                        <Link
                          to={`/inventory/product/${encodeURIComponent(String(r.product_id))}`}
                          className="table-link"
                          title="Open per-location stock page"
                        >
                          {qtyFmt(r.stock_on_hand ?? r.total_quantity)}
                        </Link>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
