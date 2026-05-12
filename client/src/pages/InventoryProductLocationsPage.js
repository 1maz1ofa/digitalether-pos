import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";

function qtyFmt(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function InventoryProductLocationsPage() {
  const { productId: productIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const productId = Number(productIdParam);
  const productIdOk = Number.isInteger(productId) && productId > 0;
  const locationIdParam = searchParams.get("locationId");
  const highlightLocationId = Number(locationIdParam);
  const highlightOk =
    locationIdParam != null &&
    locationIdParam !== "" &&
    Number.isInteger(highlightLocationId) &&
    highlightLocationId > 0;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!productIdOk) {
      setError("Invalid product");
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const stock = await api.inventory.stock({ productId });
      setRows(stock);
    } catch (e) {
      setRows([]);
      setError(e.message || "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }, [productId, productIdOk]);

  useEffect(() => {
    load();
  }, [load]);

  const title = rows[0]?.product_name || rows[0]?.product_code || `Product #${productId}`;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-lead" style={{ marginBottom: "0.35rem" }}>
            <Link to="/inventory" className="table-link">
              ← Inventory
            </Link>
          </p>
          <h1>Stock by location</h1>
          <p className="page-lead">
            {productIdOk ? (
              <>
                {title}
                {" · "}
                <Link to={`/products/${encodeURIComponent(String(productId))}`} className="table-link">
                  open product
                </Link>
              </>
            ) : (
              "Product locations"
            )}
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
          Refresh
        </button>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No stock recorded for this product in any location.</p>
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
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    style={
                      highlightOk && Number(r.location_id) === highlightLocationId
                        ? { background: "rgba(59, 130, 246, 0.12)" }
                        : undefined
                    }
                  >
                    <td>
                      {r.location_code ? <code style={{ marginRight: "0.4rem" }}>{r.location_code}</code> : null}
                      {r.location_name || "—"}
                    </td>
                    <td>{qtyFmt(r.quantity)}</td>
                    <td className="muted">{r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
