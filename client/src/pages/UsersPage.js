import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";

const LOCATION_ALL = "all";

const emptyForm = {
  email: "",
  full_name: "",
  password: "",
  role_id: "",
  location_id: "",
  is_active: true,
};

function formatDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function locationOptionLabel(loc) {
  const code = loc?.code ? String(loc.code).trim() : "";
  const name = loc?.name ? String(loc.name).trim() : "";
  if (code && name) return `${code} — ${name}`;
  return code || name || `Location #${loc.id}`;
}

export function UsersPage() {
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [locations, setLocations] = useState([]);
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
      const [users, roleRows, locationRows] = await Promise.all([
        api.users.list(),
        api.roles.list(),
        api.locations.list(),
      ]);
      setRows(users);
      setRoles(roleRows);
      setLocations(locationRows.filter((l) => l.is_active !== false));
    } catch (e) {
      setError(e.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    const defaultRole = roles[0];
    const defaultLocation = locations[0];
    setForm({
      ...emptyForm,
      role_id: defaultRole ? String(defaultRole.id) : "",
      location_id: defaultLocation ? String(defaultLocation.id) : "",
    });
    setModalOpen(true);
  }

  function openEdit(row) {
    setEditingId(row.id);
    setForm({
      email: row.email || "",
      full_name: row.full_name || "",
      password: "",
      role_id: row.role_id != null ? String(row.role_id) : "",
      location_id: row.location_id != null ? String(row.location_id) : LOCATION_ALL,
      is_active: Boolean(row.is_active),
    });
    setModalOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const roleId = Number.parseInt(form.role_id, 10);
      if (!Number.isInteger(roleId) || roleId < 1) {
        throw new Error("Role is required");
      }

      let locationId = null;
      if (form.location_id !== LOCATION_ALL) {
        const parsed = Number.parseInt(form.location_id, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error("Location is required");
        }
        locationId = parsed;
      }

      const payload = {
        email: form.email.trim(),
        full_name: form.full_name.trim(),
        role_id: roleId,
        location_id: locationId,
        is_active: form.is_active,
      };

      if (editingId) {
        if (form.password.trim()) {
          payload.password = form.password;
        }
        await api.users.update(editingId, payload);
      } else {
        if (!form.password.trim()) {
          throw new Error("Password is required for new users");
        }
        payload.password = form.password;
        await api.users.create(payload);
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
    const label = row.full_name || row.email || row.id;
    if (!window.confirm(`Delete user “${label}”?`)) return;
    setError("");
    try {
      await api.users.remove(row.id);
      await load();
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p className="page-lead">Staff accounts, roles, and default branch assignment.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Add user
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
                  <th>Full name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Location</th>
                  <th>Active</th>
                  <th>Created</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      No users yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.full_name}</td>
                      <td>{r.email}</td>
                      <td>{r.role_name || "—"}</td>
                      <td>{r.location_label || "—"}</td>
                      <td>{r.is_active ? "Yes" : "No"}</td>
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
        title={editingId ? "Edit user" : "New user"}
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
              form="user-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <form id="user-form" onSubmit={handleSubmit} className="form-grid">
          <label className="field">
            <span className="field-label">Full name</span>
            <input
              className="input"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span className="field-label">
              {editingId ? "New password (optional)" : "Password"}
            </span>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!editingId}
              minLength={editingId ? undefined : 6}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span className="field-label">Role</span>
            <select
              className="input"
              value={form.role_id}
              onChange={(e) => setForm({ ...form, role_id: e.target.value })}
              required
            >
              <option value="" disabled>
                Select role…
              </option>
              {roles.map((role) => (
                <option key={role.id} value={String(role.id)}>
                  {role.name || `Role #${role.id}`}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Location</span>
            <select
              className="input"
              value={form.location_id}
              onChange={(e) => setForm({ ...form, location_id: e.target.value })}
              required
            >
              <option value="" disabled>
                Select location…
              </option>
              <option value={LOCATION_ALL}>ALL</option>
              {locations.map((loc) => (
                <option key={loc.id} value={String(loc.id)}>
                  {locationOptionLabel(loc)}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--checkbox">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
            <span>Active</span>
          </label>
        </form>
      </Modal>
    </div>
  );
}
