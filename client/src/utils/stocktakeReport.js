const STATUS_LABELS = {
  DRAFT: "Draft",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
};

function money(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function csvNum(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
}

function qtyFmt(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function locationLabel(header) {
  const name = header?.location_name;
  const code = header?.location_code;
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

function statusLabel(status) {
  const key = String(status || "").toUpperCase();
  return STATUS_LABELS[key] || status || "—";
}

function formatReportDate(v) {
  if (!v) return "—";
  const s = String(v).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    try {
      return new Date(`${s}T12:00:00`).toLocaleDateString();
    } catch {
      return s;
    }
  }
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return String(v);
  }
}

function escapeCsvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(cells) {
  return cells.map(escapeCsvCell).join(",");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reportFilename(header, ext) {
  const ref = (header.reference_number || `stocktake-${header.id}`).replace(/[^\w.-]+/g, "_");
  const date = String(header.stocktake_date || "").slice(0, 10);
  return `${ref}${date ? `-${date}` : ""}.${ext}`;
}

export function sumDetailValues(details) {
  let system = 0;
  let actual = 0;
  let variance = 0;
  for (const row of details || []) {
    const s = Number(row.system_value);
    const a = Number(row.actual_value);
    const v = Number(row.variance_value);
    if (Number.isFinite(s)) system += s;
    if (Number.isFinite(a)) actual += a;
    if (Number.isFinite(v)) variance += v;
  }
  return { system, actual, variance };
}

function buildSummaryRows(header) {
  return [
    ["Description", header.description || ""],
    ["Reference", header.reference_number || ""],
    ["Stock take date", formatReportDate(header.stocktake_date)],
    ["Location", locationLabel(header)],
    ["Status", statusLabel(header.status)],
    ["Created by", header.created_by || ""],
    ["Comments", header.comments || ""],
    ["Lines", header.total_items ?? 0],
    ["Counted value", money(header.total_counted_value)],
    ["System value", money(header.total_system_value)],
    ["Variance", money(header.total_variance_value)],
  ];
}

export function downloadStocktakeCsv(header, details) {
  if (!header) return;

  const lines = [];
  lines.push(csvRow(["Stock Take Report"]));
  lines.push("");
  lines.push(csvRow(["Field", "Value"]));
  for (const [label, value] of buildSummaryRows(header)) {
    lines.push(csvRow([label, value]));
  }
  lines.push("");
  lines.push(csvRow(["Count lines"]));
  lines.push(
    csvRow([
      "Product code",
      "Product description",
      "Cost",
      "System qty",
      "Actual qty",
      "Variance qty",
      "System value",
      "Actual value",
      "Variance value",
      "Comments",
    ])
  );

  for (const row of details || []) {
    lines.push(
      csvRow([
        productCode(row),
        productDescription(row),
        csvNum(row.product_cost),
        csvNum(row.system_count),
        csvNum(row.actual_count),
        csvNum(row.variance_count),
        csvNum(row.system_value),
        csvNum(row.actual_value),
        csvNum(row.variance_value),
        row.comments || "",
      ])
    );
  }

  if ((details || []).length > 0) {
    const totals = sumDetailValues(details);
    lines.push(
      csvRow([
        "",
        "Total",
        "",
        "",
        "",
        "",
        csvNum(totals.system),
        csvNum(totals.actual),
        csvNum(totals.variance),
        "",
      ])
    );
  }

  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFilename(header, "csv");
  a.click();
  URL.revokeObjectURL(url);
}

function buildPrintHtml(header, details) {
  const summaryRows = buildSummaryRows(header)
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");

  const detailList = details || [];
  const valueTotals = sumDetailValues(detailList);

  const detailRows = detailList.length
    ? detailList
        .map(
          (row) => `<tr>
      <td>${escapeHtml(productCode(row) || "—")}</td>
      <td>${escapeHtml(productDescription(row) || "—")}</td>
      <td class="num">${escapeHtml(money(row.product_cost))}</td>
      <td class="num">${escapeHtml(qtyFmt(row.system_count))}</td>
      <td class="num">${escapeHtml(qtyFmt(row.actual_count))}</td>
      <td class="num">${escapeHtml(qtyFmt(row.variance_count))}</td>
      <td class="num">${escapeHtml(money(row.system_value))}</td>
      <td class="num">${escapeHtml(money(row.actual_value))}</td>
      <td class="num">${escapeHtml(money(row.variance_value))}</td>
    </tr>`
        )
        .join("") +
      `<tr class="totals">
      <td colspan="2"><strong>Total</strong></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td class="num"><strong>${escapeHtml(money(valueTotals.system))}</strong></td>
      <td class="num"><strong>${escapeHtml(money(valueTotals.actual))}</strong></td>
      <td class="num"><strong>${escapeHtml(money(valueTotals.variance))}</strong></td>
    </tr>`
    : `<tr><td colspan="9" class="empty">No count lines.</td></tr>`;

  const title = escapeHtml(
    header.description || header.reference_number || `Stock take #${header.id}`
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title} — Stock take report</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      color: #111;
      margin: 1.25rem;
      line-height: 1.4;
    }
    h1 { font-size: 1.35rem; margin: 0 0 0.25rem; }
    .meta { color: #555; margin: 0 0 1.25rem; font-size: 11px; }
    h2 {
      font-size: 0.95rem;
      margin: 1.25rem 0 0.5rem;
      border-bottom: 1px solid #ccc;
      padding-bottom: 0.25rem;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
    th, td {
      border: 1px solid #ddd;
      padding: 0.35rem 0.5rem;
      text-align: left;
      vertical-align: top;
    }
    .summary th {
      width: 38%;
      background: #f5f5f5;
      font-weight: 600;
    }
    .details th {
      background: #f0f0f0;
      font-size: 11px;
    }
    .num { text-align: right; white-space: nowrap; }
    tr.totals td { background: #f8f8f8; border-top: 2px solid #bbb; }
    .empty { text-align: center; color: #666; font-style: italic; }
    @page {
      margin: 0.75in 0.5in 0.5in 0.5in;
      @top-right {
        content: "Page " counter(page) " of " counter(pages);
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 10px;
        color: #555;
      }
    }
    @media print {
      body { margin: 0; }
      h2 { break-after: avoid; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>Stock take report</h1>
  <p class="meta">Printed ${new Date().toLocaleString()}</p>
  <h2>Summary</h2>
  <table class="summary">
    <tbody>${summaryRows}</tbody>
  </table>
  <h2>Count lines (${(details || []).length})</h2>
  <table class="details">
    <thead>
      <tr>
        <th>Product code</th>
        <th>Product description</th>
        <th class="num">Cost</th>
        <th class="num">System qty</th>
        <th class="num">Actual qty</th>
        <th class="num">Var. qty</th>
        <th class="num">System val.</th>
        <th class="num">Actual val.</th>
        <th class="num">Var. val.</th>
      </tr>
    </thead>
    <tbody>${detailRows}</tbody>
  </table>
</body>
</html>`;
}

function writeHtmlToDocument(doc, html) {
  doc.open();
  doc.write(html);
  doc.close();
}

function schedulePrint(targetWindow, onDone) {
  const triggerPrint = () => {
    try {
      targetWindow.focus();
      targetWindow.print();
    } finally {
      onDone?.();
    }
  };

  // Defer until after layout/paint so Save as PDF is not blank.
  const schedule = () => setTimeout(triggerPrint, 300);

  if (targetWindow.document.readyState === "complete") {
    schedule();
  } else {
    targetWindow.addEventListener("load", schedule, { once: true });
  }
}

export function printStocktakePdf(header, details) {
  if (!header) return;

  const html = buildPrintHtml(header, details);

  // Do not pass noopener here — it makes window.open() return null in modern browsers.
  const printWindow = window.open("about:blank", "_blank");
  if (printWindow) {
    printWindow.opener = null;
    writeHtmlToDocument(printWindow.document, html);
    schedulePrint(printWindow);
    return;
  }

  // Pop-up blocked: print via a hidden iframe (no extra window required).
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Stock take report");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(iframe);

  const frameWin = iframe.contentWindow;
  if (!frameWin) {
    iframe.remove();
    window.alert("Could not open the print view. Allow pop-ups or use Export CSV.");
    return;
  }

  writeHtmlToDocument(frameWin.document, html);
  schedulePrint(frameWin, () => {
    setTimeout(() => iframe.remove(), 1000);
  });
}
