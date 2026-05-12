import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { readPosWorkstation } from "../posWorkstationStorage";

function qtyFmt(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

const emptyForm = {
  from_location_id: "",
  product_id: "",
  to_location_id: "",
  promised_quantity: "",
};

export function InventoryPromisesPage() {
  const [searchParams] = useSearchParams();
  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);
  const [fromLocationId, setFromLocationId] = useState("");
  const [promises, setPromises] = useState([]);
  const [fromLocationPromises, setFromLocationPromises] = useState([]);
  const [stockRows, setStockRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const activeLocations = useMemo(
    () => locations.filter((l) => l.is_active !== false),
    [locations]
  );

  const promisedByProductId = useMemo(() => {
    const m = new Map();
    for (const p of fromLocationPromises) {
      const pid = p.product_id;
      const open = Number(p.promised_quantity);
      const reserved = Number(p.reserved_quantity);
      const q =
        (Number.isFinite(open) ? open : 0) +
        (Number.isFinite(reserved) ? reserved : 0);
      m.set(pid, (m.get(pid) || 0) + q);
    }
    return m;
  }, [fromLocationPromises]);

  const stockByProductId = useMemo(() => {
    const m = new Map();
    for (const r of stockRows) {
      const q = Number(r.quantity);
      m.set(r.product_id, Number.isFinite(q) ? q : 0);
    }
    return m;
  }, [stockRows]);

  const availableByProductId = useMemo(() => {
    const ids = new Set([
      ...stockByProductId.keys(),
      ...promisedByProductId.keys(),
    ]);
    const m = new Map();
    for (const id of ids) {
      const onHand = stockByProductId.get(id) ?? 0;
      const promised = promisedByProductId.get(id) ?? 0;
      m.set(id, onHand - promised);
    }
    return m;
  }, [stockByProductId, promisedByProductId]);

  const loadBase = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const ws = readPosWorkstation();
      const settingsReq =
        ws != null
          ? api.pos.settings({ locationId: ws.locationId, terminalId: ws.terminalId })
          : api.pos.settings();
      const [locs, prods, settings] = await Promise.all([
        api.locations.list(),
        api.products.list(),
        settingsReq,
      ]);
      setLocations(locs);
      setProducts(prods.filter((p) => p.is_active !== false));

      const active = locs.filter((l) => l.is_active !== false);
      const defId = settings?.defaultLocationId;
      const defOk =
        defId != null && active.some((l) => String(l.id) === String(defId));
      if (defOk) {
        setFromLocationId(String(defId));
      } else if (active.length) {
        setFromLocationId(String(active[0].id));
      } else {
        setFromLocationId("");
      }
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPromisesData = useCallback(async () => {
    const productParam = searchParams.get("product");
    const productParsed = parseInt(productParam, 10);
    const productFilter =
      Number.isInteger(productParsed) && productParsed > 0
        ? productParsed
        : null;
    setTableLoading(true);
    setError("");
    try {
      const plist = await api.inventory.promises.list(
        productFilter != null ? { productId: productFilter } : {}
      );
      setPromises(plist);
    } catch (e) {
      setError(e.message || "Failed to load promises");
      setPromises([]);
    } finally {
      setTableLoading(false);
    }
  }, [searchParams]);

  const loadAvailabilityData = useCallback(async (locationId) => {
    const lid = parseInt(locationId, 10);
    if (!Number.isInteger(lid) || lid < 1) {
      setFromLocationPromises([]);
      setStockRows([]);
      return;
    }
    try {
      const [plist, stock] = await Promise.all([
        api.inventory.promises.list({ fromLocationId: lid }),
        api.inventory.stock({ locationId: lid }),
      ]);
      setFromLocationPromises(plist);
      setStockRows(stock);
    } catch {
      setFromLocationPromises([]);
      setStockRows([]);
    }
  }, []);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  useEffect(() => {
    loadPromisesData();
  }, [loadPromisesData]);

  useEffect(() => {
    if (!fromLocationId) return;
    loadAvailabilityData(fromLocationId);
  }, [fromLocationId, loadAvailabilityData]);

  useEffect(() => {
    if (!modalOpen) return;
    if (!form.from_location_id) return;
    loadAvailabilityData(form.from_location_id);
  }, [modalOpen, form.from_location_id, loadAvailabilityData]);

  function openCreate() {
    setForm({ ...emptyForm, from_location_id: fromLocationId });
    setFormError("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setFormError("");
  }

  const destinationOptions = useMemo(() => {
    const lid = parseInt(form.from_location_id || fromLocationId, 10);
    return activeLocations.filter((l) => l.id !== lid);
  }, [activeLocations, form.from_location_id, fromLocationId]);

  const selectedProductAvailable = useMemo(() => {
    const pid = parseInt(form.product_id, 10);
    if (!Number.isInteger(pid) || pid < 1) return null;
    return availableByProductId.get(pid) ?? 0;
  }, [form.product_id, availableByProductId]);

  async function handleSubmit(e) {
    e.preventDefault();
    const fromId = parseInt(form.from_location_id, 10);
    const productId = parseInt(form.product_id, 10);
    const toId = parseInt(form.to_location_id, 10);
    const qty = Number(form.promised_quantity);

    setSaving(true);
    setFormError("");
    try {
      if (!Number.isInteger(fromId) || fromId < 1) {
        setFormError("Choose your location first");
        return;
      }
      if (!Number.isInteger(productId) || productId < 1) {
        setFormError("Choose a product");
        return;
      }
      if (!Number.isInteger(toId) || toId < 1) {
        setFormError("Choose a destination location");
        return;
      }
      if (toId === fromId) {
        setFormError("Destination must be a different location");
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        setFormError("Enter a quantity greater than zero");
        return;
      }
      const avail = availableByProductId.get(productId) ?? 0;
      if (qty > avail) {
        setFormError(
          `Quantity exceeds available to promise (${qtyFmt(avail)}).`
        );
        return;
      }
      await api.inventory.promises.create({
        from_location_id: fromId,
        to_location_id: toId,
        product_id: productId,
        promised_quantity: qty,
      });
      setFromLocationId(String(fromId));
      closeModal();
      await Promise.all([loadPromisesData(), loadAvailabilityData(fromId)]);
    } catch (err) {
      setFormError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toLocationCell(row) {
    if (!row) return "—";
    const name = row.to_location_name;
    const code = row.to_location_code;
    if (name && code) return `${name} (${code})`;
    return name || code || "—";
  }

  function fromLocationCell(row) {
    if (!row) return "—";
    const name = row.from_location_name;
    const code = row.from_location_code;
    if (name && code) return `${name} (${code})`;
    return name || code || "—";
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Stock promises</h1>
          <p className="page-lead">
            Commit quantities from your location&apos;s on-hand stock for another
            location. You cannot promise more than on-hand minus all existing promise
            commitments from this location (including quantities already reserved at the
            destination POS).
          </p>
        </div>
        <div className="page-header-actions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => loadPromisesData()}
            disabled={loading || tableLoading}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={openCreate}
            disabled={activeLocations.length < 2}
          >
            New promise
          </button>
        </div>
      </header>

      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="card">
        <div className="card-header-row">
          <h2 className="card-title">All stock promises</h2>
        </div>
        {loading ? (
          <p className="muted" style={{ padding: "1rem" }}>
            Loading…
          </p>
        ) : tableLoading ? (
          <p className="muted" style={{ padding: "1rem" }}>
            Loading…
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Product</th>
                  <th>From location</th>
                  <th>To location</th>
                  <th>Promised quantity</th>
                  <th>Reserved quantity</th>
                </tr>
              </thead>
              <tbody>
                {promises.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No promises yet. Use &quot;New promise&quot; to reserve stock
                      for another store.
                    </td>
                  </tr>
                ) : (
                  promises.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.created_at)}</td>
                      <td>
                        {row.product_code ? <code>{row.product_code}</code> : null}{" "}
                        {row.product_name || "—"}
                      </td>
                      <td>{fromLocationCell(row)}</td>
                      <td>{toLocationCell(row)}</td>
                      <td>{qtyFmt(row.promised_quantity)}</td>
                      <td>{qtyFmt(row.reserved_quantity)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        title="New stock promise"
        isOpen={modalOpen}
        onClose={closeModal}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button
              type="submit"
              form="promise-create-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Create promise"}
            </button>
          </>
        }
      >
        {formError ? (
          <div className="alert alert-error" role="alert" style={{ marginBottom: "1rem" }}>
            {formError}
          </div>
        ) : null}
        <form
          id="promise-create-form"
          onSubmit={handleSubmit}
          className="form-grid form-grid--2"
        >
          <label className="field">
            <span className="field-label">From location</span>
            <select
              id="promise-from-loc"
              className="input"
              value={form.from_location_id}
              onChange={(e) =>
                setForm({ ...form, from_location_id: e.target.value, to_location_id: "" })
              }
              required
            >
              <option value="">Select source location…</option>
              {activeLocations.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.name || l.code || `Location #${l.id}`}
                  {l.code ? ` (${l.code})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--full">
            <span className="field-label">Product</span>
            <select
              id="promise-product"
              className="input"
              value={form.product_id}
              onChange={(e) =>
                setForm({ ...form, product_id: e.target.value })
              }
              required
            >
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.code ? `${p.code} — ` : ""}
                  {p.name || `Product #${p.id}`}
                </option>
              ))}
            </select>
            {form.product_id && selectedProductAvailable != null ? (
              <span className="muted" style={{ fontSize: "0.85rem" }}>
                Available to promise:{" "}
                <strong>{qtyFmt(selectedProductAvailable)}</strong>
              </span>
            ) : null}
          </label>
          <label className="field">
            <span className="field-label">To location</span>
            <select
              id="promise-to"
              className="input"
              value={form.to_location_id}
              onChange={(e) =>
                setForm({ ...form, to_location_id: e.target.value })
              }
              required
            >
              <option value="">Select destination…</option>
              {destinationOptions.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.name || l.code || `Location #${l.id}`}
                  {l.code ? ` (${l.code})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Promised quantity</span>
            <input
              id="promise-qty"
              className="input"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={form.promised_quantity}
              onChange={(e) =>
                setForm({ ...form, promised_quantity: e.target.value })
              }
              required
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}
