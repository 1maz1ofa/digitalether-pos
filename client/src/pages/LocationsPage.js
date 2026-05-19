import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Modal } from "../components/Modal";
import { useTableAccess } from "../hooks/useTableAccess";

const emptyLocationForm = {
  code: "",
  name: "",
  d365_id: "",
  address: "",
  is_active: true,
};

const emptyTerminalForm = {
  location_id: "",
  starting_number: "100000001",
  next_number: "100000001",
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

function getD365IdValue(row) {
  const raw = row?.d365_id ?? row?.d365Id ?? row?.D365_ID ?? null;
  return raw === null || raw === undefined ? "" : String(raw);
}

function getNextTerminalPreviewCode(locationCode, terminals) {
  const prefix = String(locationCode || "").trim().toUpperCase();
  if (!prefix) return "";
  const suffixRe = new RegExp(`^${prefix}(\\d{2})$`, "i");
  const used = [];
  for (const terminal of terminals) {
    const code = String(terminal?.code || "").trim();
    const match = code.match(suffixRe);
    if (!match) continue;
    const seq = Number.parseInt(match[1], 10);
    if (Number.isInteger(seq)) used.push(seq);
  }
  const next = (used.length ? Math.max(...used) : 0) + 1;
  if (next > 99) return `${prefix}99`;
  return `${prefix}${String(next).padStart(2, "0")}`;
}

export function LocationsPage() {
  const locationPerms = useTableAccess("location");
  const terminalPerms = useTableAccess("terminal");
  const [rows, setRows] = useState([]);
  const [terminalRows, setTerminalRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [locationEditingId, setLocationEditingId] = useState(null);
  const [locationEditingRow, setLocationEditingRow] = useState(null);
  const [locationForm, setLocationForm] = useState(emptyLocationForm);
  const [locationSaving, setLocationSaving] = useState(false);

  const [terminalModalOpen, setTerminalModalOpen] = useState(false);
  const [terminalEditingId, setTerminalEditingId] = useState(null);
  const [terminalEditingRow, setTerminalEditingRow] = useState(null);
  const [terminalForm, setTerminalForm] = useState(emptyTerminalForm);
  const [terminalSaving, setTerminalSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [locationRows, terminals] = await Promise.all([
        api.locations.list(),
        api.terminals.list(),
      ]);
      setRows(locationRows);
      setTerminalRows(terminals);
    } catch (e) {
      setError(e.message || "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setLocationEditingId(null);
    setLocationEditingRow(null);
    setLocationForm({ ...emptyLocationForm });
    setLocationModalOpen(true);
  }

  function openEdit(row) {
    setLocationEditingId(row.id);
    setLocationEditingRow(row);
    setLocationForm({
      code: row.code || "",
      name: row.name || "",
      d365_id: getD365IdValue(row),
      address: row.address || "",
      is_active: Boolean(row.is_active),
    });
    setLocationModalOpen(true);
  }

  function closeLocationModal() {
    if (locationSaving) return;
    if (terminalModalOpen) return;
    setLocationModalOpen(false);
  }

  function closeTerminalModal() {
    if (terminalSaving) return;
    setTerminalModalOpen(false);
  }

  function openCreateTerminal() {
    if (!locationEditingRow) return;
    setTerminalEditingId(null);
    setTerminalEditingRow(null);
    setTerminalForm({
      ...emptyTerminalForm,
      location_id: String(locationEditingRow.id),
    });
    setTerminalModalOpen(true);
  }

  function openEditTerminal(row) {
    setTerminalEditingId(row.id);
    setTerminalEditingRow(row);
    setTerminalForm({
      location_id: row.location_id != null ? String(row.location_id) : "",
      starting_number:
        row.starting_number !== null && row.starting_number !== undefined
          ? String(row.starting_number)
          : "",
      next_number:
        row.next_number !== null && row.next_number !== undefined
          ? String(row.next_number)
          : "",
      is_active: Boolean(row.is_active),
    });
    setTerminalModalOpen(true);
  }

  async function handleLocationSubmit(e) {
    e.preventDefault();
    setLocationSaving(true);
    setError("");
    try {
      const payload = {
        code: locationForm.code ? String(locationForm.code).trim() : null,
        name: locationForm.name,
        d365_id: locationForm.d365_id
          ? String(locationForm.d365_id).trim()
          : null,
        address: locationForm.address || null,
        is_active: locationForm.is_active,
      };
      if (locationEditingId) {
        await api.locations.update(locationEditingId, payload);
      } else {
        await api.locations.create(payload);
      }
      setLocationModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setLocationSaving(false);
    }
  }

  async function handleTerminalSubmit(e) {
    e.preventDefault();
    setTerminalSaving(true);
    setError("");
    try {
      if (terminalEditingId) {
        await api.terminals.update(terminalEditingId, {
          starting_number: terminalForm.starting_number,
          next_number: terminalForm.next_number,
          is_active: terminalForm.is_active,
        });
      } else {
        const locationId = Number.parseInt(terminalForm.location_id, 10);
        await api.terminals.create({
          location_id: Number.isInteger(locationId) ? locationId : null,
          starting_number: terminalForm.starting_number,
          next_number: terminalForm.next_number,
          is_active: terminalForm.is_active,
        });
      }
      setTerminalModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setTerminalSaving(false);
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete location “${row.name || row.code}”?`)) return;
    setError("");
    try {
      await api.locations.remove(row.id);
      await load();
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  }

  async function handleDeleteTerminal(row) {
    if (!window.confirm(`Delete terminal “${row.name || row.code}”?`)) return;
    setError("");
    try {
      await api.terminals.remove(row.id);
      await load();
    } catch (err) {
      setError(err.message || "Delete failed");
    }
  }

  const editingTerminals = locationEditingRow
    ? terminalRows.filter(
        (t) => String(t.location_id) === String(locationEditingRow.id)
      )
    : [];

  const previewTerminalCode = locationEditingRow
    ? getNextTerminalPreviewCode(locationEditingRow.code, editingTerminals)
    : "";
  const previewTerminalName = previewTerminalCode;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Locations</h1>
          <p className="page-lead">Branches and stores where stock is held.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={openCreate}
          disabled={!locationPerms.canCreate}
        >
          Add location
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
                  <th>Address</th>
                  <th>Active</th>
                  <th>Created</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No locations yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <code>{r.code}</code>
                      </td>
                      <td>{r.name}</td>
                      <td className="cell-clip">{r.address || "—"}</td>
                      <td>{r.is_active ? "Yes" : "No"}</td>
                      <td className="muted nowrap">
                        {formatDate(r.created_at)}
                      </td>
                      <td className="col-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => openEdit(r)}
                          disabled={!locationPerms.canEdit}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDelete(r)}
                          disabled={!locationPerms.canDelete}
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
        title={locationEditingId ? "Edit location" : "New location"}
        isOpen={locationModalOpen}
        onClose={closeLocationModal}
        panelClassName={locationEditingId ? "modal-panel--wide" : ""}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={locationSaving}
              onClick={closeLocationModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="location-form"
              className="btn btn-primary"
              disabled={locationSaving}
            >
              {locationSaving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <form
          id="location-form"
          onSubmit={handleLocationSubmit}
          className="form-grid"
        >
          <p className="muted field--full" style={{ margin: 0 }}>
            Fields marked with * are required.
          </p>
          <label className="field">
            <span className="field-label">Code *</span>
            <input
              className="input"
              value={locationForm.code}
              onChange={(e) =>
                setLocationForm({
                  ...locationForm,
                  code: e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, ""),
                })
              }
              required
              minLength={3}
              maxLength={3}
              placeholder="ABC"
            />
          </label>
          <label className="field">
            <span className="field-label">Name *</span>
            <input
              className="input"
              value={locationForm.name}
              onChange={(e) =>
                setLocationForm({ ...locationForm, name: e.target.value })
              }
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">D365 ID *</span>
            <input
              className="input"
              value={locationForm.d365_id}
              onChange={(e) =>
                setLocationForm({ ...locationForm, d365_id: e.target.value })
              }
              required
            />
          </label>
          <label className="field field--full">
            <span className="field-label">Address</span>
            <textarea
              className="input textarea"
              rows={3}
              value={locationForm.address}
              onChange={(e) =>
                setLocationForm({ ...locationForm, address: e.target.value })
              }
            />
          </label>
          <label className="field field--checkbox">
            <input
              type="checkbox"
              checked={locationForm.is_active}
              onChange={(e) =>
                setLocationForm({
                  ...locationForm,
                  is_active: e.target.checked,
                })
              }
            />
            <span>Active</span>
          </label>
        </form>

        {locationEditingId ? (
          <section className="location-terminals location-terminals--modal">
            <div className="location-terminals-header">
              <h2>Terminals</h2>
              <div className="location-terminals-header-actions">
                <span className="muted">
                  {editingTerminals.length} terminal
                  {editingTerminals.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={openCreateTerminal}
                  disabled={!terminalPerms.canCreate}
                >
                  Add terminal
                </button>
              </div>
            </div>
            {editingTerminals.length === 0 ? (
              <p className="muted location-terminals-empty">
                No terminals for this location yet.
              </p>
            ) : (
              <div className="table-wrap location-terminals-table-wrap">
                <table className="data-table location-terminals-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Starting #</th>
                      <th>Next #</th>
                      <th>Active</th>
                      <th>Created</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editingTerminals.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <code>{t.code}</code>
                        </td>
                        <td>{t.name || "—"}</td>
                        <td className="nowrap">{t.starting_number}</td>
                        <td className="nowrap">{t.next_number}</td>
                        <td>{t.is_active ? "Yes" : "No"}</td>
                        <td className="muted nowrap">
                          {formatDate(t.created_at)}
                        </td>
                        <td className="col-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => openEditTerminal(t)}
                            disabled={!terminalPerms.canEdit}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => handleDeleteTerminal(t)}
                            disabled={!terminalPerms.canDelete}
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
        title={terminalEditingId ? "Edit terminal" : "New terminal"}
        isOpen={terminalModalOpen}
        onClose={closeTerminalModal}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={terminalSaving}
              onClick={closeTerminalModal}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="terminal-form"
              className="btn btn-primary"
              disabled={terminalSaving}
            >
              {terminalSaving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        <form
          id="terminal-form"
          onSubmit={handleTerminalSubmit}
          className="form-grid form-grid--2"
        >
          <label className="field field--full">
            <span className="field-label">Location</span>
            <input
              className="input"
              value={
                locationEditingRow
                  ? locationEditingRow.name || locationEditingRow.code
                  : terminalEditingRow?.location_name ||
                    terminalEditingRow?.location_code ||
                    ""
              }
              readOnly
              disabled
            />
          </label>
          <label className="field">
            <span className="field-label">Code</span>
            <input
              className="input"
              value={
                terminalEditingId
                  ? terminalEditingRow?.code || ""
                  : previewTerminalCode
              }
              readOnly
              disabled
              placeholder="Auto-generated"
            />
            {!terminalEditingId ? (
              <span
                className="muted"
                style={{ fontSize: "0.85em", marginTop: "0.25rem" }}
              >
                Auto-generated as <code>LOCATION</code> + 2-digit sequence
                (e.g. AVO01).
              </span>
            ) : null}
          </label>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={
                terminalEditingId
                  ? terminalEditingRow?.name || ""
                  : previewTerminalName
              }
              readOnly
              disabled
              placeholder="Auto-generated"
            />
          </label>
          <label className="field">
            <span className="field-label">Starting number</span>
            <input
              className="input"
              type="number"
              step="1"
              min="0"
              value={terminalForm.starting_number}
              onChange={(e) =>
                setTerminalForm({
                  ...terminalForm,
                  starting_number: e.target.value,
                })
              }
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Next number</span>
            <input
              className="input"
              type="number"
              step="1"
              min="0"
              value={terminalForm.next_number}
              onChange={(e) =>
                setTerminalForm({
                  ...terminalForm,
                  next_number: e.target.value,
                })
              }
              required
            />
          </label>
          <label className="field field--checkbox">
            <input
              type="checkbox"
              checked={terminalForm.is_active}
              onChange={(e) =>
                setTerminalForm({
                  ...terminalForm,
                  is_active: e.target.checked,
                })
              }
            />
            <span>Active</span>
          </label>
        </form>
      </Modal>
    </div>
  );
}
