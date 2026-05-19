import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { useAuth } from "../context/AuthContext";
import { filterLocationsForUser, getUserLocationId } from "../utils/userLocation";
import {
  downloadStocktakeCsv,
  printStocktakePdf,
  sumDetailValues,
} from "../utils/stocktakeReport";
import { useTableAccess } from "../hooks/useTableAccess";

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "APPROVED", label: "Approved" },
  { value: "CANCELLED", label: "Cancelled" },
];

const emptyHeaderForm = {
  description: "",
  stocktake_date: "",
  location_id: "",
  reference_number: "",
  status: "DRAFT",
  comments: "",
  created_by: "",
};

const emptyDetailForm = {
  product_id: "",
  product_cost: "",
  system_count: "",
  actual_count: "",
  comments: "",
};

function todayIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function money(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qtyFmt(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function locationLabel(row) {
  const name = row?.name || row?.location_name;
  const code = row?.code || row?.location_code;
  if (name && code) return `${name} (${code})`;
  return name || code || "—";
}

function productCode(row) {
  return row?.product_code || row?.code || "";
}

function productDescription(row) {
  const name = row?.product_name || row?.name;
  if (name) return name;
  if (row?.product_id != null) return `#${row.product_id}`;
  return "";
}

function productLabel(p) {
  if (!p) return "—";
  const code = productCode(p);
  const name = productDescription(p);
  if (code && name) return `${code} — ${name}`;
  return name || code || "—";
}

export function StocktakeDetailPage() {
  const headerPerms = useTableAccess("stocktake_header");
  const detailPerms = useTableAccess("stocktake_detail");
  const { user } = useAuth();
  const userLocationId = useMemo(() => getUserLocationId(user), [user]);
  const canChangeLocation = userLocationId == null;

  const { id: idParam } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isNew = idParam === "new" || /\/stocktakes\/new\/?$/.test(pathname);
  const stocktakeId = isNew ? null : Number(idParam);
  const idOk = isNew || (Number.isInteger(stocktakeId) && stocktakeId > 0);

  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);
  const [header, setHeader] = useState(null);
  const [details, setDetails] = useState([]);
  const [headerForm, setHeaderForm] = useState({ ...emptyHeaderForm, stocktake_date: todayIsoDate() });
  const [loading, setLoading] = useState(true);
  const [savingHeader, setSavingHeader] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailEditingId, setDetailEditingId] = useState(null);
  const [detailForm, setDetailForm] = useState(emptyDetailForm);
  const [detailSaving, setDetailSaving] = useState(false);
  const [lineSearch, setLineSearch] = useState("");

  const isLocked = useMemo(() => {
    const s = String(header?.status || headerForm.status || "").toUpperCase();
    return s === "APPROVED" || s === "CANCELLED";
  }, [header, headerForm.status]);

  const canConfirm = useMemo(() => {
    return !isNew && Boolean(header) && !isLocked && details.length > 0;
  }, [header, isNew, isLocked, details.length]);

  const loadMeta = useCallback(async () => {
    const [locs, prods] = await Promise.all([
      api.locations.list(),
      api.products.list(),
    ]);
    const activeLocs = locs.filter((l) => l.is_active !== false);
    setLocations(filterLocationsForUser(user, activeLocs));
    setProducts(prods.filter((p) => p.is_active !== false));
    if (isNew && userLocationId != null) {
      setHeaderForm((prev) => ({ ...prev, location_id: String(userLocationId) }));
    }
  }, [isNew, user, userLocationId]);

  const loadStocktake = useCallback(async () => {
    if (!idOk) {
      setError("Invalid stock take");
      setLoading(false);
      return;
    }
    if (isNew) {
      setHeader(null);
      setDetails([]);
      setHeaderForm({ ...emptyHeaderForm, stocktake_date: todayIsoDate() });
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const bundle = await api.stocktakes.get(stocktakeId);
      setHeader(bundle.header);
      setDetails(Array.isArray(bundle.details) ? bundle.details : []);
      const h = bundle.header;
      setHeaderForm({
        description: h.description || "",
        stocktake_date: String(h.stocktake_date || "").slice(0, 10),
        location_id: h.location_id != null ? String(h.location_id) : "",
        reference_number: h.reference_number || "",
        status: h.status || "DRAFT",
        comments: h.comments || "",
        created_by: h.created_by || "",
      });
    } catch (e) {
      setHeader(null);
      setDetails([]);
      setError(e.message || "Failed to load stock take");
    } finally {
      setLoading(false);
    }
  }, [idOk, isNew, stocktakeId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await loadMeta();
        await loadStocktake();
      } catch (e) {
        setError(e.message || "Failed to load");
        setLoading(false);
      }
    })();
  }, [loadMeta, loadStocktake]);

  async function saveHeader(e) {
    e.preventDefault();
    setSavingHeader(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        description: headerForm.description.trim(),
        stocktake_date: headerForm.stocktake_date,
        location_id: parseInt(headerForm.location_id, 10),
        reference_number: headerForm.reference_number.trim() || null,
        status: headerForm.status,
        comments: headerForm.comments.trim() || null,
        created_by: headerForm.created_by.trim() || null,
      };
      if (!payload.description) {
        setError("Description is required");
        return;
      }
      if (!payload.stocktake_date) {
        setError("Stock take date is required");
        return;
      }
      if (!Number.isInteger(payload.location_id) || payload.location_id < 1) {
        setError("Choose a location");
        return;
      }

      if (isNew) {
        const bundle = await api.stocktakes.create(payload);
        setSuccess("Stock take created.");
        navigate(`/stocktakes/${bundle.header.id}`, { replace: true });
        return;
      }

      const bundle = await api.stocktakes.update(stocktakeId, {
        ...payload,
        updated_by: payload.created_by,
      });
      setHeader(bundle.header);
      setDetails(bundle.details || []);
      setSuccess("Header saved.");
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSavingHeader(false);
    }
  }

  async function populateFromStock(includeZero = false) {
    if (!header?.id) return;
    setPopulating(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.stocktakes.populateFromStock(header.id, { include_zero: includeZero });
      setHeader(res.header);
      setDetails(res.details || []);
      setSuccess(`Added ${res.inserted ?? 0} line(s) from inventory.`);
    } catch (err) {
      setError(err.message || "Populate failed");
    } finally {
      setPopulating(false);
    }
  }

  function openAddDetail() {
    setDetailEditingId(null);
    setDetailForm(emptyDetailForm);
    setDetailModalOpen(true);
  }

  function openEditDetail(row) {
    setDetailEditingId(row.id);
    setDetailForm({
      product_id: String(row.product_id),
      product_cost: row.product_cost != null ? String(row.product_cost) : "",
      system_count: row.system_count != null ? String(row.system_count) : "",
      actual_count: row.actual_count != null ? String(row.actual_count) : "",
      comments: row.comments || "",
    });
    setDetailModalOpen(true);
  }

  async function saveDetail(e) {
    e.preventDefault();
    if (!header?.id) return;
    const productId = parseInt(detailForm.product_id, 10);
    if (!Number.isInteger(productId) || productId < 1) {
      setError("Choose a product");
      return;
    }

    setDetailSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        product_id: productId,
        product_cost: detailForm.product_cost === "" ? undefined : Number(detailForm.product_cost),
        system_count: detailForm.system_count === "" ? undefined : Number(detailForm.system_count),
        actual_count: detailForm.actual_count === "" ? undefined : Number(detailForm.actual_count),
        comments: detailForm.comments.trim() || null,
      };

      if (detailEditingId) {
        await api.stocktakes.updateDetail(header.id, detailEditingId, payload);
      } else {
        await api.stocktakes.addDetail(header.id, payload);
      }
      setDetailModalOpen(false);
      const bundle = await api.stocktakes.get(header.id);
      setHeader(bundle.header);
      setDetails(bundle.details || []);
      setSuccess(detailEditingId ? "Line updated." : "Line added.");
    } catch (err) {
      setError(err.message || "Save line failed");
    } finally {
      setDetailSaving(false);
    }
  }

  async function confirmStocktake() {
    if (!header?.id) return;
    const linesWithVariance = details.filter((d) => {
      const v = Number(d.variance_count);
      return Number.isFinite(v) && v !== 0;
    });
    const msg =
      linesWithVariance.length === 0
        ? "No quantity variances on this stock take. Confirm anyway? Inventory will not change."
        : `Confirm this stock take and post ${linesWithVariance.length} stock adjustment(s)? ` +
          "Increases use STOCKADJIN; decreases use STOCKADJOUT. This cannot be undone.";
    if (!window.confirm(msg)) return;

    setConfirming(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.stocktakes.confirm(header.id, {
        approved_by: headerForm.created_by.trim() || null,
      });
      setHeader(res.header);
      setDetails(Array.isArray(res.details) ? res.details : []);
      setHeaderForm((prev) => ({
        ...prev,
        status: res.header?.status || "APPROVED",
      }));
      const n = res.movements_created ?? 0;
      setSuccess(
        n > 0
          ? `Stock take confirmed. ${n} inventory movement(s) posted.`
          : "Stock take confirmed. No inventory movements were required (zero variances)."
      );
    } catch (e) {
      setError(e.message || "Failed to confirm stock take");
    } finally {
      setConfirming(false);
    }
  }

  async function deleteDetail(row) {
    if (!header?.id) return;
    if (!window.confirm(`Remove line for ${productLabel(row)}?`)) return;
    setError("");
    setSuccess("");
    try {
      await api.stocktakes.removeDetail(header.id, row.id);
      const bundle = await api.stocktakes.get(header.id);
      setHeader(bundle.header);
      setDetails(bundle.details || []);
      setSuccess("Line removed.");
    } catch (err) {
      setError(err.message || "Delete line failed");
    }
  }

  const productsAvailable = useMemo(() => {
    const used = new Set(details.map((d) => d.product_id));
    if (detailEditingId) {
      const editing = details.find((d) => d.id === detailEditingId);
      if (editing) used.delete(editing.product_id);
    }
    return products.filter((p) => !used.has(p.id));
  }, [products, details, detailEditingId]);

  const filteredDetails = useMemo(() => {
    const q = lineSearch.trim().toLowerCase();
    if (!q) return details;
    return details.filter((row) => {
      const code = productCode(row).toLowerCase();
      const name = productDescription(row).toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [details, lineSearch]);

  const displayedValueTotals = useMemo(
    () => sumDetailValues(filteredDetails),
    [filteredDetails]
  );

  if (!idOk) {
    return (
      <div className="page">
        <p className="alert alert-error">Invalid stock take.</p>
        <Link to="/stocktakes" className="btn btn-secondary">
          Back to list
        </Link>
      </div>
    );
  }

  const showSplitLayout = !isNew && Boolean(header);

  return (
    <div className={`page${showSplitLayout ? " page--stocktake-detail" : ""}`}>
      <header className="page-header page-header--compact">
        <div>
          <p className="page-breadcrumb">
            <Link to="/stocktakes">Stock takes</Link>
            <span aria-hidden> / </span>
            <span>{isNew ? "New" : header?.reference_number || `#${stocktakeId}`}</span>
          </p>
          <h1>{isNew ? "New stock take" : header?.description || "Stock take"}</h1>
          {!isNew && header ? (
            <p className="page-lead">
              {locationLabel({
                name: header.location_name,
                code: header.location_code,
              })}{" "}
              · {header.status || "DRAFT"} · {details.length} line(s)
              {header.approved_at ? (
                <>
                  {" "}
                  · Confirmed
                  {header.approved_by ? ` by ${header.approved_by}` : ""}
                  {" "}
                  {String(header.approved_at).slice(0, 10)}
                </>
              ) : null}
            </p>
          ) : (
            <p className="page-lead">Create the header, then add or import count lines.</p>
          )}
        </div>
        <div className="page-header-actions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {!isNew && header ? (
            <>
              {canConfirm ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={loading || confirming || !headerPerms.canEdit}
                  onClick={confirmStocktake}
                >
                  {confirming ? "Confirming…" : "Confirm stock take"}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || !headerPerms.canRead}
                onClick={() => printStocktakePdf(header, details)}
              >
                Print PDF
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || !headerPerms.canRead}
                onClick={() => downloadStocktakeCsv(header, details)}
              >
                Export CSV
              </button>
            </>
          ) : null}
          <Link to="/stocktakes" className="btn btn-secondary">
            Back to list
          </Link>
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

      <div className={showSplitLayout ? "stocktake-detail-split" : undefined}>
        <div
          className={
            showSplitLayout
              ? "stocktake-detail-split__panel stocktake-detail-split__panel--header"
              : undefined
          }
        >
          <div className="card stocktake-header-card">
            <h2 className="card-title">Header</h2>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : (
              <form
                className="stocktake-header-form stocktake-header-form--compact"
                onSubmit={saveHeader}
              >
            <section className="form-section form-section--flush" aria-label="Stock take details">
              <div className="form-grid form-grid--3">
                <label className="field field--full">
                  <span className="field-label">Description</span>
                  <input
                    className="input"
                    value={headerForm.description}
                    onChange={(e) =>
                      setHeaderForm({ ...headerForm, description: e.target.value })
                    }
                    required
                    disabled={isLocked && !isNew}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Date</span>
                  <input
                    className="input"
                    type="date"
                    value={headerForm.stocktake_date}
                    onChange={(e) =>
                      setHeaderForm({ ...headerForm, stocktake_date: e.target.value })
                    }
                    required
                    disabled={isLocked && !isNew}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Location</span>
                  <select
                    className="input"
                    value={headerForm.location_id}
                    onChange={(e) =>
                      setHeaderForm({ ...headerForm, location_id: e.target.value })
                    }
                    required
                    disabled={
                      !canChangeLocation || ((!isNew && details.length > 0) || isLocked)
                    }
                  >
                    <option value="">Select location…</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {locationLabel(loc)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Reference</span>
                  <input
                    className="input"
                    value={headerForm.reference_number}
                    onChange={(e) =>
                      setHeaderForm({ ...headerForm, reference_number: e.target.value })
                    }
                    placeholder="Optional"
                    disabled={isLocked && !isNew}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Status</span>
                  <select
                    className="input"
                    value={headerForm.status}
                    onChange={(e) =>
                      setHeaderForm({ ...headerForm, status: e.target.value })
                    }
                    disabled={isNew || isLocked}
                  >
                    {STATUS_OPTIONS.filter(
                      (opt) =>
                        opt.value !== "APPROVED" ||
                        String(headerForm.status || "").toUpperCase() === "APPROVED"
                    ).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Created by</span>
                  <input
                    className="input"
                    value={headerForm.created_by}
                    onChange={(e) =>
                      setHeaderForm({ ...headerForm, created_by: e.target.value })
                    }
                    disabled={isLocked && !isNew}
                  />
                </label>
                <label className="field field--full">
                  <span className="field-label">Comments</span>
                  <textarea
                    className="input textarea textarea--compact"
                    rows={2}
                    value={headerForm.comments}
                    onChange={(e) =>
                      setHeaderForm({ ...headerForm, comments: e.target.value })
                    }
                    disabled={isLocked && !isNew}
                  />
                </label>
              </div>
            </section>

            {!isNew && header ? (
              <section className="form-section form-section--flush" aria-label="Totals">
                <div className="stocktake-totals-grid stocktake-totals-grid--compact">
                  <div>
                    <span className="muted">Lines</span>
                    <strong>{header.total_items ?? 0}</strong>
                  </div>
                  <div>
                    <span className="muted">Counted value</span>
                    <strong>{money(header.total_counted_value)}</strong>
                  </div>
                  <div>
                    <span className="muted">System value</span>
                    <strong>{money(header.total_system_value)}</strong>
                  </div>
                  <div>
                    <span className="muted">Variance</span>
                    <strong>{money(header.total_variance_value)}</strong>
                  </div>
                </div>
              </section>
            ) : null}
            <div className="form-actions stocktake-header-form-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  savingHeader ||
                  (isLocked && !isNew) ||
                  (isNew ? !headerPerms.canCreate : !headerPerms.canEdit)
                }
              >
                {savingHeader ? "Saving…" : isNew ? "Create stock take" : "Save header"}
              </button>
              {canConfirm ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    loading ||
                    confirming ||
                    savingHeader ||
                    !headerPerms.canEdit
                  }
                  onClick={confirmStocktake}
                >
                  {confirming ? "Confirming…" : "Confirm stock take"}
                </button>
              ) : null}
            </div>
          </form>
            )}
          </div>
        </div>

        {!isNew && header ? (
          <div
            className={
              showSplitLayout
                ? "stocktake-detail-split__panel stocktake-detail-split__panel--details"
                : undefined
            }
          >
            <div className="card stocktake-details-card">
          <div className="card-header-row">
            <h2 className="card-title">Count lines</h2>
            <div className="card-header-actions">
              <input
                className="input"
                type="search"
                placeholder="Search code or description…"
                value={lineSearch}
                onChange={(e) => setLineSearch(e.target.value)}
                style={{ minWidth: "16rem" }}
                aria-label="Search count lines"
              />
              <button
                type="button"
                className="btn btn-secondary"
                disabled={populating || isLocked || !detailPerms.canCreate}
                onClick={() => populateFromStock(false)}
              >
                {populating ? "Importing…" : "Import from stock"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={populating || isLocked || !detailPerms.canCreate}
                onClick={() => populateFromStock(true)}
                title="Include products with zero on-hand at this location"
              >
                Import all products
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isLocked || !detailPerms.canCreate}
                onClick={openAddDetail}
              >
                Add line
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Cost</th>
                  <th>System qty</th>
                  <th>Actual qty</th>
                  <th>Var. qty</th>
                  <th>System val.</th>
                  <th>Actual val.</th>
                  <th>Var. val.</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {details.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="muted">
                      No lines yet. Import from stock or add products manually.
                    </td>
                  </tr>
                ) : filteredDetails.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="muted">
                      No lines match your search.
                    </td>
                  </tr>
                ) : (
                  filteredDetails.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {productCode(row) ? <code>{productCode(row)}</code> : "—"}
                      </td>
                      <td>{productDescription(row) || "—"}</td>
                      <td>{money(row.product_cost)}</td>
                      <td>{qtyFmt(row.system_count)}</td>
                      <td>{qtyFmt(row.actual_count)}</td>
                      <td>{qtyFmt(row.variance_count)}</td>
                      <td>{money(row.system_value)}</td>
                      <td>{money(row.actual_value)}</td>
                      <td>{money(row.variance_value)}</td>
                      <td className="col-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          disabled={isLocked || !detailPerms.canEdit}
                          onClick={() => openEditDetail(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          disabled={isLocked || !detailPerms.canDelete}
                          onClick={() => deleteDetail(row)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {filteredDetails.length > 0 ? (
                <tfoot>
                  <tr className="stocktake-lines-total">
                    <td colSpan={2}>
                      <strong>Total</strong>
                    </td>
                    <td />
                    <td />
                    <td />
                    <td />
                    <td>
                      <strong>{money(displayedValueTotals.system)}</strong>
                    </td>
                    <td>
                      <strong>{money(displayedValueTotals.actual)}</strong>
                    </td>
                    <td>
                      <strong>{money(displayedValueTotals.variance)}</strong>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
            </div>
          </div>
        ) : null}
      </div>

      <Modal
        title={detailEditingId ? "Edit count line" : "Add count line"}
        isOpen={detailModalOpen}
        onClose={() => !detailSaving && setDetailModalOpen(false)}
        panelClassName="modal-panel--wide"
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={detailSaving}
              onClick={() => setDetailModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="stocktake-detail-form"
              className="btn btn-primary"
              disabled={
                detailSaving ||
                (detailEditingId ? !detailPerms.canEdit : !detailPerms.canCreate)
              }
            >
              {detailSaving ? "Saving…" : "Save line"}
            </button>
          </>
        }
      >
        <form id="stocktake-detail-form" className="form-grid" onSubmit={saveDetail}>
          <label className="field field--full">
            <span className="field-label">Product</span>
            <select
              className="input"
              value={detailForm.product_id}
              onChange={(e) => {
                const pid = e.target.value;
                const prod = products.find((p) => String(p.id) === pid);
                setDetailForm({
                  ...detailForm,
                  product_id: pid,
                  product_cost:
                    prod?.unit_cost != null ? String(prod.unit_cost) : detailForm.product_cost,
                });
              }}
              required
              disabled={Boolean(detailEditingId)}
            >
              <option value="">Select product…</option>
              {(detailEditingId
                ? products.filter((p) => String(p.id) === detailForm.product_id)
                : productsAvailable
              ).map((p) => (
                <option key={p.id} value={p.id}>
                  {productLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Unit cost</span>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={detailForm.product_cost}
              onChange={(e) =>
                setDetailForm({ ...detailForm, product_cost: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span className="field-label">System count</span>
            <input
              className="input"
              type="number"
              step="any"
              value={detailForm.system_count}
              onChange={(e) =>
                setDetailForm({ ...detailForm, system_count: e.target.value })
              }
              placeholder="From inventory if blank"
            />
          </label>
          <label className="field">
            <span className="field-label">Actual count</span>
            <input
              className="input"
              type="number"
              step="any"
              value={detailForm.actual_count}
              onChange={(e) =>
                setDetailForm({ ...detailForm, actual_count: e.target.value })
              }
              required
            />
          </label>
          <label className="field field--full">
            <span className="field-label">Comments</span>
            <textarea
              className="input textarea"
              rows={2}
              value={detailForm.comments}
              onChange={(e) =>
                setDetailForm({ ...detailForm, comments: e.target.value })
              }
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}
