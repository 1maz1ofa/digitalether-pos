import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";

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

export function ReserveIssuePage() {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [selectedQueueId, setSelectedQueueId] = useState("");
  const [pending, setPending] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingListError, setPendingListError] = useState("");
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [data, setData] = useState({ header: null, items: [] });

  /** Pending queues sorted by sale invoice number (same value written onto promises at checkout). */
  const pendingSorted = useMemo(() => {
    const rows = Array.isArray(pending) ? [...pending] : [];
    rows.sort((a, b) => {
      const ha = a?.header;
      const hb = b?.header;
      const ia = String(ha?.invoice_number ?? "").trim();
      const ib = String(hb?.invoice_number ?? "").trim();
      if (!ia && !ib) return (Number(ha?.id) || 0) - (Number(hb?.id) || 0);
      if (!ia) return 1;
      if (!ib) return -1;
      const c = ia.localeCompare(ib, undefined, { numeric: true, sensitivity: "base" });
      if (c !== 0) return c;
      return (Number(ha?.id) || 0) - (Number(hb?.id) || 0);
    });
    return rows;
  }, [pending]);

  const refreshPending = useCallback(async () => {
    setPendingListError("");
    setPendingLoading(true);
    try {
      const res = await api.inventory.reserveIssues.listPending();
      setPending(Array.isArray(res.pending) ? res.pending : []);
    } catch (e) {
      setPending([]);
      setPendingListError(e.message || "Could not load pending reserve queues.");
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  const applyLookupResult = useCallback((res) => {
    setData(res);
    if (res.header?.id != null) {
      setSelectedQueueId(String(res.header.id));
      setInvoiceNumber(String(res.header.invoice_number || "").trim());
    } else {
      setSelectedQueueId("");
    }
  }, []);

  const load = useCallback(async () => {
    const inv = String(invoiceNumber || "").trim();
    if (!inv) {
      setError("Enter an invoice number.");
      return;
    }
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await api.inventory.reserveIssues.getByInvoice(inv);
      const queues = Array.isArray(res.queues) ? res.queues : null;
      if (queues && queues.length > 1) {
        setData({ header: null, items: [] });
        setSelectedQueueId("");
        setError(
          `This invoice has ${queues.length} pending reserve queues (different ship-from stores). ` +
            "Select the queue to issue from the pending list above, or issue one store at a time."
        );
        return;
      }
      applyLookupResult(res);
      if (!res.header) {
        setError("No pending reserve issue for that invoice (nothing to ship from promise stock).");
      }
    } catch (e) {
      setData({ header: null, items: [] });
      setSelectedQueueId("");
      setError(e.message || "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [invoiceNumber, applyLookupResult]);

  const loadByQueueId = useCallback(
    async (headerIdStr) => {
      const id = parseInt(String(headerIdStr || "").trim(), 10);
      if (!Number.isInteger(id) || id <= 0) {
        setData({ header: null, items: [] });
        setError("");
        return;
      }
      setError("");
      setSuccess("");
      setLoading(true);
      try {
        const res = await api.inventory.reserveIssues.getByHeaderId(id);
        applyLookupResult(res);
        if (!res.header) {
          setError("That reserve queue is no longer pending (it may have been issued already).");
          await refreshPending();
        }
      } catch (e) {
        setData({ header: null, items: [] });
        setError(e.message || "Lookup failed");
      } finally {
        setLoading(false);
      }
    },
    [applyLookupResult, refreshPending]
  );

  async function issue() {
    if (!data.header) return;
    const inv = String(invoiceNumber || "").trim();
    const headerIdNum =
      data.header.id != null ? parseInt(String(data.header.id), 10) : NaN;
    const headerIdOk = Number.isInteger(headerIdNum) && headerIdNum > 0;
    if (!headerIdOk && !inv) {
      setError("Missing invoice reference for issue.");
      return;
    }
    setIssuing(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.inventory.reserveIssues.issue({
        header_id: headerIdOk ? headerIdNum : undefined,
        invoice_number: inv || undefined,
      });
      const invLabel = res.invoice_number || inv || `#${res.header_id}`;
      setSuccess(
        `Issued ${res.movements_posted} line(s); RESERVEOUT movements posted. Reserve queue cleared for invoice ${invLabel}.`
      );
      setData({ header: null, items: [] });
      setSelectedQueueId("");
      await refreshPending();
    } catch (e) {
      setError(e.message || "Issue failed");
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Reserve issue</h1>
          <p className="page-lead">
            After a POS sale consumes incoming promises, stock stays on hand at the promising
            location until you issue it here. Each reserve queue ships from one source store only;
            if an invoice used promises from several stores, issue each queue separately (lines from
            the same store may appear together). Choose a queue from the list (sorted by invoice) or
            look up by invoice number when there is only one ship-from queue, then post shipment: this
            clears that queue, lowers <code>reserved_quantity</code> on each promise, deducts on-hand at
            the source location, and writes inventory movements with movement type{" "}
            <code>RESERVEOUT</code>.
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

      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="card-header-row">
          <h2 className="card-title">Pending reserve sales</h2>
          <button
            type="button"
            className="btn"
            onClick={() => refreshPending()}
            disabled={pendingLoading}
          >
            {pendingLoading ? "Refreshing…" : "Refresh list"}
          </button>
        </div>
        <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <label className="field">
            <span className="field-label">Invoice number (from sale / promises)</span>
            <select
              className="input"
              value={selectedQueueId}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedQueueId(v);
                setError("");
                setSuccess("");
                if (!v) {
                  setData({ header: null, items: [] });
                  setInvoiceNumber("");
                  return;
                }
                void loadByQueueId(v);
              }}
              disabled={pendingLoading}
            >
              <option value="">
                {pendingLoading ? "Loading…" : "Choose an invoice…"}
              </option>
              {pendingSorted.map(({ header: h, items: its }) => {
                const loc = h.location_name || h.location_code || `#${h.location_id}`;
                const invTrim = String(h.invoice_number ?? "").trim();
                const invLabel = invTrim || `(no invoice # — queue ${h.id})`;
                const n = Array.isArray(its) ? its.length : 0;
                const shipFrom =
                  its && its.length
                    ? its[0].from_location_name ||
                      its[0].from_location_code ||
                      `#${its[0].from_location_id}`
                    : "—";
                const label = `${invLabel} · ship from ${shipFrom} · sell at ${loc} · ${formatDate(h.created_at)} · ${n} line(s)`;
                return (
                  <option key={h.id} value={String(h.id)}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>
          {pendingListError ? (
            <p className="muted" role="alert">
              {pendingListError}
            </p>
          ) : !pendingLoading && !pending.length ? (
            <p className="muted">No invoices are waiting for reserve issue right now.</p>
          ) : null}

          <p className="muted" style={{ margin: 0 }}>
            Or type the invoice number and load — lines to issue appear below.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end" }}>
            <label className="field" style={{ minWidth: "16rem", flex: "1 1 12rem" }}>
              <span className="field-label">Invoice number</span>
              <input
                className="input"
                value={invoiceNumber}
                onChange={(e) => {
                  setInvoiceNumber(e.target.value);
                  setSelectedQueueId("");
                }}
                placeholder="e.g. A-00042"
                autoComplete="off"
              />
            </label>
            <button type="button" className="btn btn-primary" onClick={() => load()} disabled={loading}>
              {loading ? "Loading…" : "Load"}
            </button>
          </div>
        </div>
      </div>

      {data.header ? (
        <div className="card">
          <div className="card-header-row">
            <h2 className="card-title">Pending lines</h2>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => issue()}
              disabled={issuing || !data.items.length}
            >
              {issuing ? "Issuing…" : "Issue and post RESERVEOUT"}
            </button>
          </div>
          <p className="muted" style={{ padding: "0 1rem" }}>
            Invoice <code>{data.header.invoice_number || "—"}</code> · selling location{" "}
            {data.header.location_name || data.header.location_code || `#${data.header.location_id}`}{" "}
            · created {formatDate(data.header.created_at)} · {data.header.total_products} product(s)
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Ship from (promise source)</th>
                  <th>Promise id</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.product_code ? <code>{row.product_code}</code> : null}{" "}
                      {row.product_name || "—"}
                    </td>
                    <td>{qtyFmt(row.quantity)}</td>
                    <td>
                      {row.from_location_name || row.from_location_code || `#${row.from_location_id}`}
                    </td>
                    <td>
                      <code>{row.promise_id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
