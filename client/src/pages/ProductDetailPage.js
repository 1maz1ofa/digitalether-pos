import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, apiMediaUrl } from "../api";

function money(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function qtyFmt(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function vatLabel(row) {
  if (row?.vat_name) {
    const pct = Number(row.vat_percentage);
    return Number.isFinite(pct) ? `${row.vat_name} (${pct.toFixed(2)}%)` : row.vat_name;
  }
  return "—";
}

export function ProductDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const idOk = Number.isInteger(id) && id > 0;

  const [product, setProduct] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!idOk) {
      setError("Invalid product");
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const [p, locs] = await Promise.all([
        api.products.get(id),
        api.products.inventoryLocations(id),
      ]);
      setProduct(p);
      setLocations(locs);
    } catch (e) {
      setProduct(null);
      setLocations([]);
      setError(e.message || "Failed to load product");
    } finally {
      setLoading(false);
    }
  }, [id, idOk]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="page-lead" style={{ marginBottom: "0.35rem" }}>
            <Link to="/products" className="table-link">
              ← Products
            </Link>
          </p>
          {loading ? (
            <h1>Product</h1>
          ) : product ? (
            <h1>{product.name}</h1>
          ) : (
            <h1>Product</h1>
          )}
          {product && !loading ? (
            <p className="page-lead">
              <code>{product.code}</code>
              {product.category_name ? ` · ${product.category_name}` : ""}
            </p>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : product ? (
        <>
          <div className="card" style={{ marginBottom: "1rem" }}>
            <h2 className="card-title" style={{ marginTop: 0 }}>
              Details
            </h2>
            {product.image_url ? (
              <div style={{ marginBottom: "1rem" }}>
                <img
                  src={apiMediaUrl(product.image_url)}
                  alt=""
                  className="detail-product-image"
                />
              </div>
            ) : null}
            <dl className="detail-dl">
              <dt>Unit price</dt>
              <dd>{money(product.unit_price)}</dd>
              <dt>VAT</dt>
              <dd>{vatLabel(product)}</dd>
              <dt>Active</dt>
              <dd>{product.is_active ? "Yes" : "No"}</dd>
              {product.unit_of_measure ? (
                <>
                  <dt>Unit of measure</dt>
                  <dd>{product.unit_of_measure}</dd>
                </>
              ) : null}
            </dl>
          </div>

          <div className="card">
            <h2 className="card-title" style={{ marginTop: 0 }}>
              Stock by location
            </h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: "1rem" }}>
              Reserved and promised quantities are shown per location.
            </p>
            {locations.length === 0 ? (
              <p className="muted">No stock or promises for this product at any location yet.</p>
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
                    {locations.map((row) => (
                      <tr key={row.location_id}>
                        <td>
                          {row.location_code ? (
                            <code style={{ marginRight: "0.4rem" }}>{row.location_code}</code>
                          ) : null}
                          {row.location_name || "—"}
                        </td>
                        <td>
                          <Link
                            to={`/inventory/product/${encodeURIComponent(String(id))}?locationId=${encodeURIComponent(String(row.location_id))}`}
                            className="table-link"
                            title="View on-hand quantity for this branch"
                          >
                            {qtyFmt(row.stock_on_hand ?? row.total_quantity)}
                          </Link>
                        </td>
                        <td>{qtyFmt(row.reserved_quantity)}</td>
                        <td>
                          <Link
                            to={`/promises?location=${encodeURIComponent(String(row.location_id))}&product=${encodeURIComponent(String(id))}`}
                            className="table-link"
                            title="View outgoing promises from this branch for this product"
                          >
                            {qtyFmt(row.out_promised_quantity ?? row.promised_quantity)}
                          </Link>
                        </td>
                        <td>
                          <Link
                            to={`/promises?product=${encodeURIComponent(String(id))}`}
                            className="table-link"
                            title="View promises for this product"
                          >
                            {qtyFmt(row.in_promised_quantity)}
                          </Link>
                        </td>
                        <td className="muted">
                          {row.updated_at ? new Date(row.updated_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
