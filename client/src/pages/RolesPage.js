import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";

const emptyForm = { name: "", description: "" };

const PERMISSION_KIND_TABLE = "TABLE";
const PERMISSION_KIND_MENU = "MENU";

const emptyRightForm = {
  permission_kind: PERMISSION_KIND_TABLE,
  table_name: "",
  field_name: "",
  menu_key: "",
  submenu_key: "",
  can_read: false,
  can_edit: false,
  can_delete: false,
};

function isMenuObjectType(objectType) {
  return objectType === "MENU" || objectType === "SUBMENU";
}

function objectTypeLabel(objectType) {
  switch (objectType) {
    case "FIELD":
      return "Field";
    case "MENU":
      return "Menu";
    case "SUBMENU":
      return "Sub menu";
    default:
      return "Table";
  }
}

function parseObjectName(objectName) {
  const s = String(objectName || "").trim();
  if (!s) return { table_name: "", field_name: "" };
  const dot = s.indexOf(".");
  if (dot === -1) return { table_name: s, field_name: "" };
  return { table_name: s.slice(0, dot), field_name: s.slice(dot + 1) };
}

function buildObjectName(tableName, fieldName) {
  const table = String(tableName || "").trim();
  const field = String(fieldName || "").trim();
  if (!table) return "";
  return field ? `${table}.${field}` : table;
}

function mergeOption(list, value) {
  if (!value) return list;
  return list.includes(value) ? list : [value, ...list];
}

function formatDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function permLabel(v) {
  return v ? "Yes" : "—";
}

export function RolesPage() {
  const [rows, setRows] = useState([]);
  const [rightRows, setRightRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [rightModalOpen, setRightModalOpen] = useState(false);
  const [rightEditingId, setRightEditingId] = useState(null);
  const [rightForm, setRightForm] = useState(emptyRightForm);
  const [rightSaving, setRightSaving] = useState(false);
  const [dbTables, setDbTables] = useState([]);
  const [dbColumns, setDbColumns] = useState([]);
  const [menuCatalog, setMenuCatalog] = useState([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [menusLoading, setMenusLoading] = useState(false);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [roles, rights] = await Promise.all([
        api.roles.list(),
        api.rights.list(),
      ]);
      setRows(roles);
      setRightRows(rights);
    } catch (e) {
      setError(e.message || "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!rightModalOpen || rightForm.permission_kind !== PERMISSION_KIND_TABLE) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setSchemaLoading(true);
      try {
        const tables = await api.rights.schemaTables();
        if (!cancelled) setDbTables(Array.isArray(tables) ? tables : []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load database tables");
      } finally {
        if (!cancelled) setSchemaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rightModalOpen, rightForm.permission_kind]);

  useEffect(() => {
    if (!rightModalOpen || rightForm.permission_kind !== PERMISSION_KIND_MENU) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setMenusLoading(true);
      try {
        const menus = await api.rights.schemaMenus();
        if (!cancelled) setMenuCatalog(Array.isArray(menus) ? menus : []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load menu items");
      } finally {
        if (!cancelled) setMenusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rightModalOpen, rightForm.permission_kind]);

  useEffect(() => {
    if (
      !rightModalOpen ||
      rightForm.permission_kind !== PERMISSION_KIND_TABLE ||
      !rightForm.table_name
    ) {
      setDbColumns([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setColumnsLoading(true);
      try {
        const columns = await api.rights.schemaColumns(rightForm.table_name);
        if (!cancelled) setDbColumns(Array.isArray(columns) ? columns : []);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load table columns");
      } finally {
        if (!cancelled) setColumnsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rightModalOpen, rightForm.permission_kind, rightForm.table_name]);

  function openCreate() {
    setEditingId(null);
    setEditingRow(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(row) {
    setEditingId(row.id);
    setEditingRow(row);
    setForm({
      name: row.name || "",
      description: row.description || "",
    });
    setModalOpen(true);
  }

  function closeRoleModal() {
    if (saving) return;
    if (rightModalOpen) return;
    setModalOpen(false);
  }

  function closeRightModal() {
    if (rightSaving) return;
    setRightModalOpen(false);
  }

  function openCreateRight() {
    if (!editingRow) return;
    setRightEditingId(null);
    setRightForm({ ...emptyRightForm });
    setRightModalOpen(true);
  }

  function openEditRight(row) {
    const { table_name, field_name } = parseObjectName(row.object_name);
    const menuMode = isMenuObjectType(row.object_type);
    setRightEditingId(row.id);
    setRightForm({
      permission_kind: menuMode ? PERMISSION_KIND_MENU : PERMISSION_KIND_TABLE,
      table_name: menuMode ? "" : table_name,
      field_name: menuMode ? "" : field_name,
      menu_key: menuMode ? table_name : "",
      submenu_key: menuMode ? field_name : "",
      can_read: Boolean(row.can_read),
      can_edit: menuMode ? false : Boolean(row.can_edit),
      can_delete: menuMode ? false : Boolean(row.can_delete),
    });
    setRightModalOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
      };
      if (editingId) {
        await api.roles.update(editingId, payload);
      } else {
        await api.roles.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleRightSubmit(e) {
    e.preventDefault();
    setRightSaving(true);
    setError("");
    try {
      const isMenu = rightForm.permission_kind === PERMISSION_KIND_MENU;
      const object_name = isMenu
        ? buildObjectName(rightForm.menu_key, rightForm.submenu_key)
        : buildObjectName(rightForm.table_name, rightForm.field_name);
      if (!object_name) {
        setError(isMenu ? "Menu item is required" : "Table is required");
        setRightSaving(false);
        return;
      }
      const hasChild = isMenu
        ? Boolean(rightForm.submenu_key.trim())
        : Boolean(rightForm.field_name.trim());
      const payload = {
        object_name,
        object_type: isMenu
          ? hasChild
            ? "SUBMENU"
            : "MENU"
          : hasChild
            ? "FIELD"
            : "TABLE",
        can_read: rightForm.can_read,
        can_edit: isMenu ? false : rightForm.can_edit,
        can_delete: isMenu ? false : rightForm.can_delete,
      };
      if (rightEditingId) {
        await api.rights.update(rightEditingId, payload);
      } else {
        await api.rights.create({
          ...payload,
          role_id: editingRow.id,
        });
      }
      setRightModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setRightSaving(false);
    }
  }

  async function handleDelete(row) {
    const label = row.name || row.id;
    if (!window.confirm(`Delete role “${label}”?`)) return;
    setError("");
    try {
      await api.roles.remove(row.id);
      await load();
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  }

  async function handleDeleteRight(row) {
    const label = `${row.object_type} · ${row.object_name}`;
    if (!window.confirm(`Delete permission “${label}”?`)) return;
    setError("");
    try {
      await api.rights.remove(row.id);
      await load();
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  }

  const editingRights = editingRow
    ? rightRows.filter((r) => String(r.role_id) === String(editingRow.id))
    : [];

  const tableOptions = mergeOption(dbTables, rightForm.table_name);
  const columnOptions = mergeOption(dbColumns, rightForm.field_name);
  const isMenuPermission = rightForm.permission_kind === PERMISSION_KIND_MENU;

  const menuOptions = (() => {
    const ids = menuCatalog.map((m) => m.id);
    return mergeOption(ids, rightForm.menu_key);
  })();

  const selectedMenuItem = menuCatalog.find((m) => m.id === rightForm.menu_key);
  const submenuItems = selectedMenuItem?.children || [];
  const submenuOptions = (() => {
    const ids = submenuItems.map((c) => c.id);
    return mergeOption(ids, rightForm.submenu_key);
  })();

  const objectPreview = isMenuPermission
    ? buildObjectName(rightForm.menu_key, rightForm.submenu_key)
    : buildObjectName(rightForm.table_name, rightForm.field_name);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Roles</h1>
          <p className="page-lead">Staff permission roles assigned to users.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Add role
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
                  <th>Name</th>
                  <th>Description</th>
                  <th>Created</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No roles yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td className="muted">{r.description || "—"}</td>
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
        title={editingId ? "Edit role" : "New role"}
        isOpen={modalOpen}
        onClose={closeRoleModal}
        panelClassName={editingId ? "modal-panel--wide" : ""}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={closeRoleModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="role-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <form id="role-form" onSubmit={handleSubmit} className="form-grid">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={30}
              autoFocus
            />
          </label>
          <label className="field field--full">
            <span className="field-label">Description</span>
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
        </form>

        {editingId ? (
          <section className="location-terminals location-terminals--modal">
            <div className="location-terminals-header">
              <h2>Permissions</h2>
              <div className="location-terminals-header-actions">
                <span className="muted">
                  {editingRights.length} rule
                  {editingRights.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={openCreateRight}
                >
                  Add permission
                </button>
              </div>
            </div>
            {editingRights.length === 0 ? (
              <p className="muted location-terminals-empty">
                No permissions for this role yet.
              </p>
            ) : (
              <div className="table-wrap location-terminals-table-wrap">
                <table className="data-table location-terminals-table">
                  <thead>
                    <tr>
                      <th>Object</th>
                      <th>Type</th>
                      <th>Read</th>
                      <th>Edit</th>
                      <th>Delete</th>
                      <th>Created</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editingRights.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <code>{r.object_name}</code>
                        </td>
                        <td>
                          {isMenuObjectType(r.object_type) ? "Menu" : "Table"}
                          {" · "}
                          {objectTypeLabel(r.object_type)}
                        </td>
                        <td>{permLabel(r.can_read)}</td>
                        <td>{permLabel(r.can_edit)}</td>
                        <td>{permLabel(r.can_delete)}</td>
                        <td className="muted nowrap">{formatDate(r.created_at)}</td>
                        <td className="col-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => openEditRight(r)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => handleDeleteRight(r)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </Modal>

      <Modal
        title={rightEditingId ? "Edit permission" : "New permission"}
        isOpen={rightModalOpen}
        onClose={closeRightModal}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={rightSaving}
              onClick={closeRightModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="right-form"
              className="btn btn-primary"
              disabled={rightSaving}
            >
              {rightSaving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <form id="right-form" onSubmit={handleRightSubmit} className="form-grid">
          <label className="field field--full">
            <span className="field-label">Role</span>
            <input
              className="input"
              value={editingRow?.name || ""}
              readOnly
              disabled
            />
          </label>
          <label className="field field--full">
            <span className="field-label">Object type</span>
            <select
              className="input"
              value={rightForm.permission_kind}
              onChange={(e) => {
                const permission_kind = e.target.value;
                const menuMode = permission_kind === PERMISSION_KIND_MENU;
                setRightForm({
                  ...emptyRightForm,
                  permission_kind,
                  can_read: rightForm.can_read,
                  can_edit: menuMode ? false : rightForm.can_edit,
                  can_delete: menuMode ? false : rightForm.can_delete,
                });
              }}
              required
              autoFocus
            >
              <option value={PERMISSION_KIND_TABLE}>Table</option>
              <option value={PERMISSION_KIND_MENU}>Menu</option>
            </select>
          </label>
          {isMenuPermission ? (
            <>
              <label className="field">
                <span className="field-label">Menu item</span>
                <select
                  className="input"
                  value={rightForm.menu_key}
                  onChange={(e) => {
                    const menu_key = e.target.value;
                    setRightForm({
                      ...rightForm,
                      menu_key,
                      submenu_key: "",
                    });
                  }}
                  required
                  disabled={menusLoading}
                >
                  <option value="">
                    {menusLoading ? "Loading menu items…" : "Select menu item…"}
                  </option>
                  {menuOptions.map((id) => {
                    const item = menuCatalog.find((m) => m.id === id);
                    return (
                      <option key={id} value={id}>
                        {item?.label || id}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Sub menu (optional)</span>
                <select
                  className="input"
                  value={rightForm.submenu_key}
                  onChange={(e) =>
                    setRightForm({ ...rightForm, submenu_key: e.target.value })
                  }
                  disabled={!rightForm.menu_key || !submenuItems.length}
                >
                  <option value="">
                    {!rightForm.menu_key
                      ? "Select a menu item first"
                      : !submenuItems.length
                        ? "— No sub menus —"
                        : "— Whole menu item —"}
                  </option>
                  {submenuOptions.map((id) => {
                    const item = submenuItems.find((c) => c.id === id);
                    return (
                      <option key={id} value={id}>
                        {item?.label || id}
                      </option>
                    );
                  })}
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span className="field-label">Table</span>
                <select
                  className="input"
                  value={rightForm.table_name}
                  onChange={(e) => {
                    const table_name = e.target.value;
                    setRightForm({
                      ...rightForm,
                      table_name,
                      field_name: "",
                    });
                  }}
                  required
                  disabled={schemaLoading}
                >
                  <option value="">
                    {schemaLoading ? "Loading tables…" : "Select table…"}
                  </option>
                  {tableOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Field (optional)</span>
                <select
                  className="input"
                  value={rightForm.field_name}
                  onChange={(e) =>
                    setRightForm({ ...rightForm, field_name: e.target.value })
                  }
                  disabled={!rightForm.table_name || columnsLoading}
                >
                  <option value="">
                    {!rightForm.table_name
                      ? "Select a table first"
                      : columnsLoading
                        ? "Loading columns…"
                        : "— Whole table —"}
                  </option>
                  {columnOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {objectPreview ? (
            <p className="field field--full muted">
              Object name: <code>{objectPreview}</code>
            </p>
          ) : null}
          <label className="field field--checkbox">
            <input
              type="checkbox"
              checked={rightForm.can_read}
              onChange={(e) =>
                setRightForm({ ...rightForm, can_read: e.target.checked })
              }
            />
            <span>Can read</span>
          </label>
          <label className="field field--checkbox">
            <input
              type="checkbox"
              checked={rightForm.can_edit}
              disabled={isMenuPermission}
              onChange={(e) =>
                setRightForm({ ...rightForm, can_edit: e.target.checked })
              }
            />
            <span>Can edit</span>
          </label>
          <label className="field field--checkbox">
            <input
              type="checkbox"
              checked={rightForm.can_delete}
              disabled={isMenuPermission}
              onChange={(e) =>
                setRightForm({ ...rightForm, can_delete: e.target.checked })
              }
            />
            <span>Can delete</span>
          </label>
        </form>
      </Modal>
    </div>
  );
}
