import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { PermissionLink } from "../components/PermissionLink";
import { useTableAccess } from "../hooks/useTableAccess";
import { useAuth } from "../context/AuthContext";
import { getUserLocationId } from "../utils/userLocation";

const MOVEMENTS_LIMIT = 500;

function qtyFmt(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function money(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function movementTypeLabel(row) {
  if (!row || typeof row !== "object") return "—";
  const name = row.movement_type_name ?? row.name ?? row.description ?? row.label ?? row.title;
  const code = row.movement_type_code ?? row.code ?? row.short_code;
  if (name && code) return `${name} (${code})`;
  if (name) return String(name);
  if (code) return String(code);
  if (row.movement_type_id != null) return `#${row.movement_type_id}`;
  return "—";
}

function productCell(row) {
  return (
    <>
      {row.product_code ? <code>{row.product_code}</code> : null}{" "}
      {row.product_name || "—"}
    </>
  );
}

function locationCell(row) {
  const label = row.location_name || row.location_code;
  return label || "—";
}

export function MovementPage() {
  const perms = useTableAccess("inventory_movement");
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userLocationId = useMemo(() => getUserLocationId(user), [user]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refreshMovements = useCallback(async () => {
    const mv = await api.inventory.movements(MOVEMENTS_LIMIT, userLocationId ?? undefined);
    setMovements(mv);
  }, [userLocationId]);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      await refreshMovements();
    } catch (e) {
      setError(e.message || "Failed to load movements");
    } finally {
      setLoading(false);
    }
  }, [refreshMovements]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const flash = location.state?.flashSuccess;
    if (typeof flash === "string" && flash.length > 0) {
      setSuccess(flash);
      navigate("/movement", { replace: true, state: {} });
    }
  }, [location.state, navigate]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Movement</h1>
          <p className="page-lead">
            Stock ledger by product and location. New lines are append-only.
          </p>
        </div>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="alert alert-success" role="status">
          {success}
        </div>
      ) : null}

      <div className="card">
        <div className="card-header-row">
          <h2 className="card-title">Movements</h2>
          <div className="card-header-actions">
            <PermissionLink
              canAccess={perms.canCreate}
              to="/movement/new"
              className="btn btn-primary"
            >
              New movement
            </PermissionLink>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setError("");
                refreshMovements().catch((err) => {
                  setError(err.message || "Refresh failed");
                });
              }}
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
                  <th>When</th>
                  <th>Product</th>
                  <th>Location</th>
                  <th>Movement type</th>
                  <th>Quantity</th>
                  <th>Unit cost</th>
                  <th>Total cost</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      No movements yet. Use New movement to add a line.
                    </td>
                  </tr>
                ) : (
                  movements.map((r) => (
                    <tr key={r.id}>
                      <td className="muted">
                        {r.created_at
                          ? new Date(r.created_at).toLocaleString()
                          : "—"}
                      </td>
                      <td>{productCell(r)}</td>
                      <td>{locationCell(r)}</td>
                      <td>{movementTypeLabel(r)}</td>
                      <td>{qtyFmt(r.quantity)}</td>
                      <td>{money(r.unit_cost)}</td>
                      <td>{money(r.total_cost)}</td>
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
