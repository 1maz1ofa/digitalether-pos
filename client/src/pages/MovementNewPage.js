import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { filterLocationsForUser, getUserLocationId } from "../utils/userLocation";
import { useTableAccess } from "../hooks/useTableAccess";

const emptyForm = {
  product_id: "",
  location_id: "",
  movement_type_id: "",
  quantity: "",
  unit_cost: "",
  reference_type: "",
  reference_id: "",
  notes: "",
  created_by: "",
};

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

export function MovementNewPage() {
  const perms = useTableAccess("inventory_movement");
  const navigate = useNavigate();
  const { user } = useAuth();
  const userLocationId = useMemo(() => getUserLocationId(user), [user]);
  const canChangeLocation = userLocationId == null;
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [movementTypes, setMovementTypes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [prods, locs, types] = await Promise.all([
        api.products.list(),
        api.locations.list(),
        api.inventory.movementTypes(),
      ]);
      setProducts(prods.filter((p) => p.is_active !== false));
      const activeLocs = locs.filter((l) => l.is_active !== false);
      setLocations(filterLocationsForUser(user, activeLocs));
      if (userLocationId != null) {
        setForm((prev) => ({ ...prev, location_id: String(userLocationId) }));
      }
      setMovementTypes(types);
    } catch (e) {
      setError(e.message || "Failed to load form");
    } finally {
      setLoading(false);
    }
  }, [user, userLocationId]);

  useEffect(() => {
    load();
  }, [load]);

  function buildPayload() {
    const product_id = parseInt(form.product_id, 10);
    const location_id = parseInt(form.location_id, 10);
    const movement_type_id = parseInt(form.movement_type_id, 10);
    const quantity = Number(form.quantity);
    const unit_cost = form.unit_cost === "" ? null : Number(form.unit_cost);
    const reference_id =
      form.reference_id === "" ? null : parseInt(form.reference_id, 10);
    return {
      product_id,
      location_id,
      movement_type_id,
      quantity,
      unit_cost: Number.isFinite(unit_cost) ? unit_cost : null,
      reference_type: form.reference_type.trim() || null,
      reference_id: Number.isInteger(reference_id) ? reference_id : null,
      notes: form.notes.trim() || null,
      created_by: form.created_by.trim() || null,
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = buildPayload();
      if (!Number.isInteger(payload.product_id) || payload.product_id < 1) {
        setError("Choose a product");
        return;
      }
      if (!Number.isInteger(payload.location_id) || payload.location_id < 1) {
        setError("Choose a location");
        return;
      }
      if (
        !Number.isInteger(payload.movement_type_id) ||
        payload.movement_type_id < 1
      ) {
        setError("Choose a movement type");
        return;
      }
      if (!Number.isFinite(payload.quantity) || payload.quantity === 0) {
        setError(
          "Enter a non-zero quantity (positive adds stock, negative removes)"
        );
        return;
      }
      await api.inventory.postMovement(payload);
      navigate("/movement", {
        replace: true,
        state: {
          flashSuccess:
            "Movement recorded. Ledger lines cannot be edited or removed.",
        },
      });
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>New movement</h1>
          <p className="page-lead">
            Record a stock ledger line. Positive quantity increases on-hand at
            the location; negative decreases it. Saved lines are permanent (no
            edit or delete).
          </p>
        </div>
        <Link to="/movement" className="btn btn-secondary">
          Back to list
        </Link>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="card movement-form-card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit} className="movement-new-form">
            <section className="form-section" aria-labelledby="movement-section-stock">
              <h2 id="movement-section-stock" className="form-section-title">
                Product & location
              </h2>
              <div className="form-grid form-grid--2">
                <label className="field">
                  <span className="field-label">Product</span>
                  <select
                    className="input"
                    value={form.product_id}
                    onChange={(e) =>
                      setForm({ ...form, product_id: e.target.value })
                    }
                    required
                  >
                    <option value="">— Select —</option>
                    {products.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.code ? `${p.code} — ` : ""}
                        {p.name || `Product #${p.id}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Location</span>
                  <select
                    className="input"
                    value={form.location_id}
                    onChange={(e) =>
                      setForm({ ...form, location_id: e.target.value })
                    }
                    disabled={!canChangeLocation}
                    required
                  >
                    <option value="">— Select —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={String(l.id)}>
                        {l.code ? `${l.code} — ` : ""}
                        {l.name || `Location #${l.id}`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="form-section" aria-labelledby="movement-section-qty">
              <h2 id="movement-section-qty" className="form-section-title">
                Quantity & type
              </h2>
              <div className="form-grid form-grid--2">
                <label className="field">
                  <span className="field-label">Movement type</span>
                  <select
                    className="input"
                    value={form.movement_type_id}
                    onChange={(e) =>
                      setForm({ ...form, movement_type_id: e.target.value })
                    }
                    required
                  >
                    <option value="">— Select —</option>
                    {movementTypes.map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {movementTypeLabel(t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Quantity</span>
                  <input
                    className="input"
                    type="number"
                    step="any"
                    value={form.quantity}
                    onChange={(e) =>
                      setForm({ ...form, quantity: e.target.value })
                    }
                    placeholder="e.g. 10 or -2"
                    required
                  />
                </label>
                <label className="field field--full">
                  <span className="field-label">Unit cost (optional)</span>
                  <input
                    className="input"
                    type="number"
                    step="any"
                    value={form.unit_cost}
                    onChange={(e) =>
                      setForm({ ...form, unit_cost: e.target.value })
                    }
                  />
                </label>
              </div>
            </section>

            <section className="form-section" aria-labelledby="movement-section-ref">
              <h2 id="movement-section-ref" className="form-section-title">
                External reference
              </h2>
              <p className="muted form-section-lead">
                Optional link to a source document or system record.
              </p>
              <div className="form-grid form-grid--2">
                <label className="field">
                  <span className="field-label">Reference type</span>
                  <input
                    className="input"
                    value={form.reference_type}
                    onChange={(e) =>
                      setForm({ ...form, reference_type: e.target.value })
                    }
                    placeholder="e.g. invoice, po"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Reference id</span>
                  <input
                    className="input"
                    type="number"
                    step="1"
                    value={form.reference_id}
                    onChange={(e) =>
                      setForm({ ...form, reference_id: e.target.value })
                    }
                  />
                </label>
              </div>
            </section>

            <section className="form-section" aria-labelledby="movement-section-notes">
              <h2 id="movement-section-notes" className="form-section-title">
                Notes & attribution
              </h2>
              <div className="form-grid form-grid--2">
                <label className="field field--full">
                  <span className="field-label">Notes</span>
                  <textarea
                    className="input textarea"
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Recorded by</span>
                  <input
                    className="input"
                    value={form.created_by}
                    onChange={(e) =>
                      setForm({ ...form, created_by: e.target.value })
                    }
                    placeholder="User or initials"
                  />
                </label>
              </div>
            </section>

            <div className="movement-form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || !perms.canCreate}
              >
                {saving ? "Saving…" : "Save movement"}
              </button>
              <Link to="/movement" className="btn btn-secondary">
                Cancel
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
