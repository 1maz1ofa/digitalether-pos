import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";

const emptyForm = {
  code: "",
  name: "",
  description: "",
  is_positive: "",
};

function formatDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function positiveLabel(v) {
  if (v === null || v === undefined) return "—";
  return v ? "Yes" : "No";
}

function boolToForm(v) {
  if (v === null || v === undefined) return "";
  return v ? "true" : "false";
}

export function MovementTypesPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const data = await api.inventory.movementTypes();
      setRows(data);
    } catch (e) {
      setError(e.message || "Failed to load movement types");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(row) {
    setEditingId(row.id);
    setForm({
      code: row.code || "",
      name: row.name || "",
      description: row.description || "",
      is_positive: boolToForm(row.is_positive),
    });
    setModalOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        is_positive:
          form.is_positive === "" ? null : form.is_positive === "true",
      };
      if (editingId) {
        await api.inventory.updateMovementType(editingId, payload);
      } else {
        await api.inventory.createMovementType(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete movement type "${row.code}"?`)) return;
    setError("");
    try {
      await api.inventory.removeMovementType(row.id);
      await load();
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Movement types</h1>
          <p className="page-lead">
            Define codes used for inventory movements (receipts, adjustments, issues,
            etc.).
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Add movement type
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
                  <th>Code</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Positive</th>
                  <th>Created</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No movement types yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <code>{r.code}</code>
                      </td>
                      <td>{r.name}</td>
                      <td className="muted cell-clip">{r.description || "—"}</td>
                      <td>{positiveLabel(r.is_positive)}</td>
                      <td className="muted nowrap">{formatDate(r.created_at)}</td>
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
        title={editingId ? "Edit movement type" : "New movement type"}
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
              form="movement-type-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <form id="movement-type-form" onSubmit={handleSubmit} className="form-grid">
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
            <span className="field-label">Positive effect (optional)</span>
            <select
              className="input"
              value={form.is_positive}
              onChange={(e) => setForm({ ...form, is_positive: e.target.value })}
            >
              <option value="">Not set</option>
              <option value="true">Yes (typically increases stock)</option>
              <option value="false">No (typically decreases stock)</option>
            </select>
          </label>
        </form>
      </Modal>
    </div>
  );
}
