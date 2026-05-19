import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { PermissionLink } from "../components/PermissionLink";
import { useTableAccess } from "../hooks/useTableAccess";

function money(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(v) {
  if (!v) return "—";
  try {
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(`${s}T12:00:00`).toLocaleDateString();
    }
    return new Date(v).toLocaleDateString();
  } catch {
    return String(v);
  }
}

function locationLabel(row) {
  const name = row.location_name || row.location_code;
  if (name && row.location_code && row.location_name) {
    return `${row.location_name} (${row.location_code})`;
  }
  return name || "—";
}

function statusBadgeClass(status) {
  const s = String(status || "").toUpperCase();
  if (s === "APPROVED" || s === "COMPLETED") return "badge badge--success";
  if (s === "CANCELLED") return "badge badge--muted";
  if (s === "IN_PROGRESS") return "badge badge--warn";
  return "badge";
}

export function StocktakesPage() {
  const perms = useTableAccess("stocktake_header");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const data = await api.stocktakes.list(
        statusFilter ? { status: statusFilter } : {}
      );
      setRows(data);
    } catch (e) {
      setError(e.message || "Failed to load stock takes");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const desc = (r.description || "").toLowerCase();
      const ref = (r.reference_number || "").toLowerCase();
      const loc = locationLabel(r).toLowerCase();
      return desc.includes(q) || ref.includes(q) || loc.includes(q);
    });
  }, [rows, search]);

  async function handleDelete(row) {
    const label = row.reference_number || row.description || `#${row.id}`;
    if (!window.confirm(`Delete stock take “${label}”? All count lines will be removed.`)) {
      return;
    }
    setError("");
    try {
      await api.stocktakes.remove(row.id);
      await load();
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Stock takes</h1>
          <p className="page-lead">
            Physical inventory counts by location. Open a stock take to enter counted
            quantities and review variances.
          </p>
        </div>
        <PermissionLink
          canAccess={perms.canCreate}
          to="/stocktakes/new"
          className="btn btn-primary"
        >
          New stock take
        </PermissionLink>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="card">
        <div className="card-header-row">
          <h2 className="card-title">All stock takes</h2>
          <div className="card-header-actions">
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="APPROVED">Approved</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <input
              className="input"
              type="search"
              placeholder="Search description, reference, location…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: "14rem" }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={load}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reference</th>
                  <th>Description</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Lines</th>
                  <th>Counted</th>
                  <th>System</th>
                  <th>Variance</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="muted">
                      No stock takes yet. Create one to start counting.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap">{formatDate(r.stocktake_date)}</td>
                      <td>
                        {r.reference_number ? (
                          <code>{r.reference_number}</code>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>{r.description}</td>
                      <td>{locationLabel(r)}</td>
                      <td>
                        <span className={statusBadgeClass(r.status)}>{r.status || "DRAFT"}</span>
                      </td>
                      <td>{r.total_items ?? 0}</td>
                      <td>{money(r.total_counted_value)}</td>
                      <td>{money(r.total_system_value)}</td>
                      <td>{money(r.total_variance_value)}</td>
                      <td className="col-actions">
                        <PermissionLink
                          canAccess={perms.canRead}
                          to={`/stocktakes/${r.id}`}
                          className="btn btn-sm btn-secondary"
                        >
                          Open
                        </PermissionLink>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDelete(r)}
                          disabled={!perms.canDelete}
                        >
                          Delete
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
    </div>
  );
}