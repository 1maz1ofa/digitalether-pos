import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { getUserLocationId } from "../utils/userLocation";

function qtyFmt(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function InventoryProductLocationsPage() {
  const { user } = useAuth();
  const userLocationId = getUserLocationId(user);

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
      const locations = await api.products.inventoryLocations(productId);
      const rowsList = Array.isArray(locations) ? locations : [];
      setRows(
        userLocationId != null
          ? rowsList.filter((r) => Number(r.location_id) === userLocationId)
          : rowsList
      );
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
  const productQs = productIdOk ? encodeURIComponent(String(productId)) : "";

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
                <Link to={`/products/${productQs}`} className="table-link">
                  open product
                </Link>
              </>
            ) : (
              "Product locations"
            )}
            {productIdOk ? (
              <> · Reserved and promised quantities are shown per location.</>
            ) : null}
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
                  <th>Stock on hand</th>
                  <th>Reserved</th>
                  <th>Out promised</th>
                  <th>In promised</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.location_id}
                    style={
                      highlightOk && Number(r.location_id) === highlightLocationId
                        ? { background: "rgba(59, 130, 246, 0.12)" }
                        : undefined
                    }
                  >
                    <td>
                      {r.location_code ? (
                        <code style={{ marginRight: "0.4rem" }}>{r.location_code}</code>
                      ) : null}
                      {r.location_name || "—"}
                    </td>
                    <td>{qtyFmt(r.stock_on_hand ?? r.total_quantity)}</td>
                    <td>{qtyFmt(r.reserved_quantity)}</td>
                    <td>
                      <Link
                        to={`/promises?location=${encodeURIComponent(String(r.location_id))}&product=${productQs}`}
                        className="table-link"
                        title="View outgoing promises from this location"
                      >
                        {qtyFmt(r.out_promised_quantity ?? r.promised_quantity)}
                      </Link>
                    </td>
                    <td>
                      <Link
                        to={`/promises?product=${productQs}`}
                        className="table-link"
                        title="View promises for this product"
                      >
                        {qtyFmt(r.in_promised_quantity)}
                      </Link>
                    </td>
                    <td className="muted">
                      {r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}
                    </td>
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
