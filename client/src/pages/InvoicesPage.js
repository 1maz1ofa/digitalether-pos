import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function money(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function readableSaleType(row) {
  if (row?.sale_type_name) return row.sale_type_name;
  if (row?.sale_type_code) return String(row.sale_type_code).toUpperCase();
  return "—";
}

function readableLocation(row) {
  if (row?.location_name) return row.location_name;
  if (row?.location_code) return row.location_code;
  if (row?.location_id != null) return `Location #${row.location_id}`;
  return "—";
}

function normalizeSaleTypes(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.sale_types;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (saleType) =>
      saleType &&
      Number.isInteger(Number(saleType.id)) &&
      (saleType.name != null || saleType.code != null)
  );
}

export function InvoicesPage() {
  const [rows, setRows] = useState([]);
  const [saleTypes, setSaleTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState(() => todayIsoDate());
  const [dateTo, setDateTo] = useState(() => todayIsoDate());
  const [selectedSaleTypeId, setSelectedSaleTypeId] = useState("");

  const load = useCallback(async (fromDate, toDate, saleTypeId) => {
    setError("");
    setLoading(true);
    try {
      const data = await api.invoices.list(fromDate, toDate, saleTypeId);
      setRows(Array.isArray(data?.invoices) ? data.invoices : []);
    } catch (e) {
      setError(e.message || "Failed to load invoices");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const data = await api.pos.saleTypes();
        if (!active) return;
        setSaleTypes(normalizeSaleTypes(data));
      } catch {
        if (!active) return;
        setSaleTypes([]);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    load(dateFrom, dateTo, selectedSaleTypeId);
  }, [load, dateFrom, dateTo, selectedSaleTypeId]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Invoices</h1>
          <p className="page-lead">List sales invoices by date range.</p>
        </div>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="card">
        <div className="form-grid form-grid--3" style={{ marginBottom: "1rem" }}>
          <label className="field">
            <span className="field-label">From date</span>
            <input
              className="input"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">To date</span>
            <input
              className="input"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Sale type</span>
            <select
              className="input"
              value={selectedSaleTypeId}
              onChange={(e) => setSelectedSaleTypeId(e.target.value)}
            >
              <option value="">All sales types</option>
              {saleTypes.map((saleType) => (
                <option key={saleType.id} value={String(saleType.id)}>
                  {saleType.name || saleType.code || `Sale type #${saleType.id}`}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Created</th>
                  <th>Customer</th>
                  <th>Location</th>
                  <th>Sale type</th>
                  <th>Currency</th>
                  <th>Subtotal</th>
                  <th>VAT</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="muted">
                      No invoices found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <code>{r.invoice_number || `INV-${r.id}`}</code>
                      </td>
                      <td className="muted nowrap">{formatDateTime(r.created_at)}</td>
                      <td>{r.customer_name || "Walk-in customer"}</td>
                      <td>{readableLocation(r)}</td>
                      <td>{readableSaleType(r)}</td>
                      <td>{r.currency_code || "—"}</td>
                      <td>{money(r.subtotal)}</td>
                      <td>{money(r.vat)}</td>
                      <td>
                        <strong>{money(r.total)}</strong>
                      </td>
                      <td>{r.status || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
