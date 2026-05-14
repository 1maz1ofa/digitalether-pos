import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiMediaUrl } from "../api";
import { Modal } from "../components/Modal";

const emptyForm = {
  code: "",
  name: "",
  description: "",
  barcode: "",
  unit_of_measure: "",
  category_id: "",
  vat_id: "",
  unit_cost: "",
  unit_price: "",
  is_active: true,
  reorder_level: "",
  image_url: "",
};

function money(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function vatLabel(row) {
  if (row?.vat_name) {
    const pct = Number(row.vat_percentage);
    return Number.isFinite(pct) ? `${row.vat_name} (${pct.toFixed(2)}%)` : row.vat_name;
  }
  return "—";
}

export function ProductsPage() {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [vatRates, setVatRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingImageFile, setPendingImageFile] = useState(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState(null);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [products, cats, vat] = await Promise.all([
        api.products.list(),
        api.categories.list(),
        api.vat.list(),
      ]);
      setRows(products);
      setCategories(cats);
      setVatRates(vat);
    } catch (e) {
      setError(e.message || "Failed to load products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (modalOpen) return;
    setPendingImageFile(null);
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [modalOpen]);

  function openCreate() {
    const defaultVat = vatRates.find((v) => v.is_default);
    setEditingId(null);
    setPendingImageFile(null);
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setForm({
      ...emptyForm,
      vat_id: defaultVat ? String(defaultVat.id) : "",
    });
    setModalOpen(true);
  }

  function openEdit(row) {
    setEditingId(row.id);
    setPendingImageFile(null);
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setForm({
      code: row.code || "",
      name: row.name || "",
      description: row.description || "",
      barcode: row.barcode || "",
      unit_of_measure: row.unit_of_measure || "",
      category_id: row.category_id != null ? String(row.category_id) : "",
      vat_id: row.vat_id != null ? String(row.vat_id) : "",
      unit_cost: row.unit_cost != null ? String(row.unit_cost) : "",
      unit_price: row.unit_price != null ? String(row.unit_price) : "",
      is_active: Boolean(row.is_active),
      reorder_level: row.reorder_level != null ? String(row.reorder_level) : "",
      image_url: row.image_url || "",
    });
    setModalOpen(true);
  }

  function buildPayload() {
    const category_id =
      form.category_id === "" ? null : parseInt(form.category_id, 10);
    const vat_id = form.vat_id === "" ? null : parseInt(form.vat_id, 10);
    const unit_cost = form.unit_cost === "" ? null : Number(form.unit_cost);
    const unit_price = form.unit_price === "" ? null : Number(form.unit_price);
    const reorder_level =
      form.reorder_level === "" ? null : parseInt(form.reorder_level, 10);
    return {
      code: form.code,
      name: form.name,
      description: form.description || null,
      barcode: form.barcode || null,
      unit_of_measure: form.unit_of_measure || null,
      category_id,
      vat_id: Number.isInteger(vat_id) ? vat_id : null,
      unit_cost: Number.isFinite(unit_cost) ? unit_cost : null,
      unit_price: Number.isFinite(unit_price) ? unit_price : null,
      is_active: form.is_active,
      reorder_level: Number.isInteger(reorder_level) ? reorder_level : null,
      image_url: form.image_url === "" ? null : String(form.image_url).trim(),
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = buildPayload();
      if (editingId) {
        await api.products.update(editingId, payload);
        if (pendingImageFile) {
          await api.products.uploadImage(editingId, pendingImageFile);
        }
      } else {
        const created = await api.products.create(payload);
        if (pendingImageFile && created?.id) {
          await api.products.uploadImage(created.id, pendingImageFile);
        }
      }
      setPendingImageFile(null);
      setLocalPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveStoredImage() {
    if (!editingId) {
      setLocalPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPendingImageFile(null);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.products.removeImage(editingId);
      setForm((f) => ({ ...f, image_url: "" }));
      setLocalPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPendingImageFile(null);
      await load();
    } catch (err) {
      setError(err.message || "Could not remove image");
    } finally {
      setSaving(false);
    }
  }

  function handleImageFileChange(e) {
    const file = e.target.files?.[0] ?? null;
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (!file) {
      setPendingImageFile(null);
      return;
    }
    setPendingImageFile(file);
    setLocalPreviewUrl(URL.createObjectURL(file));
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete product “${row.name || row.code}”?`)) return;
    setError("");
    try {
      await api.products.remove(row.id);
      await load();
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Products</h1>
          <p className="page-lead">Catalog items, pricing, and category assignment.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Add product
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
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Unit price</th>
                  <th>VAT</th>
                  <th>Active</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      No products yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.image_url ? (
                          <img
                            src={apiMediaUrl(r.image_url)}
                            alt=""
                            className="table-product-thumb"
                          />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <Link to={`/products/${r.id}`} className="table-link">
                          <code>{r.code}</code>
                        </Link>
                      </td>
                      <td>
                        <Link to={`/products/${r.id}`} className="table-link">
                          {r.name}
                        </Link>
                      </td>
                      <td>{r.category_name || "—"}</td>
                      <td>{money(r.unit_price)}</td>
                      <td>{vatLabel(r)}</td>
                      <td>{r.is_active ? "Yes" : "No"}</td>
                      <td className="col-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => openEdit(r)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDelete(r)}
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

      <Modal
        title={editingId ? "Edit product" : "New product"}
        isOpen={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="product-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <form id="product-form" onSubmit={handleSubmit} className="form-grid form-grid--2">
          <label className="field">
            <span className="field-label">Code</span>
            <input
              className="input"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label className="field field--full">
            <span className="field-label">Description</span>
            <textarea
              className="input textarea"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Barcode</span>
            <input
              className="input"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Unit of measure</span>
            <input
              className="input"
              value={form.unit_of_measure}
              onChange={(e) => setForm({ ...form, unit_of_measure: e.target.value })}
              placeholder="e.g. each, kg"
            />
          </label>
          <label className="field">
            <span className="field-label">Category</span>
            <select
              className="input"
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name || `Category #${c.id}`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">VAT</span>
            <select
              className="input"
              value={form.vat_id}
              onChange={(e) => setForm({ ...form, vat_id: e.target.value })}
            >
              <option value="">— None —</option>
              {vatRates.map((v) => (
                <option key={v.id} value={String(v.id)}>
                  {`${v.name || `VAT #${v.id}`} (${Number(v.percentage || 0).toFixed(2)}%)`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Unit cost</span>
            <input
              className="input"
              type="number"
              step="any"
              value={form.unit_cost}
              onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Unit price</span>
            <input
              className="input"
              type="number"
              step="any"
              value={form.unit_price}
              onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Reorder level</span>
            <input
              className="input"
              type="number"
              step="1"
              value={form.reorder_level}
              onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
            />
          </label>
          <label className="field field--checkbox">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <span>Active</span>
          </label>
          <div className="field field--full">
            <span className="field-label">Product image</span>
            <div className="product-image-field">
              {localPreviewUrl || apiMediaUrl(form.image_url) ? (
                <img
                  src={localPreviewUrl || apiMediaUrl(form.image_url)}
                  alt=""
                  className="product-form-thumb"
                />
              ) : (
                <div className="product-form-thumb product-form-thumb--empty" aria-hidden />
              )}
              <div className="product-image-field-actions">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="input"
                  onChange={handleImageFileChange}
                  disabled={saving}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={saving || (!form.image_url && !pendingImageFile)}
                  onClick={handleRemoveStoredImage}
                >
                  Remove image
                </button>
              </div>
            </div>
            <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.8rem" }}>
              JPEG, PNG, GIF, or WebP — up to 5MB. New images upload after you save the product.
            </p>
          </div>
        </form>
      </Modal>
    </div>
  );
}
