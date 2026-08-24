import {
  ALWAYS_VISIBLE_COLUMNS,
  DISPLAY_COLUMNS,
  isNormalizedExport,
  isRawCoralogixExport,
  loadNormalizedRows,
  normalizeCoralogixRows,
} from "./normalizer.js";
import { downloadCsv, parseCsv, rowsToCsv } from "./csv-utils.js";

/** @type {import("./normalizer.js").NormalizedRow[]} */
let allRows = [];
/** @type {string} */
let sourceLabel = "";

const els = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  filterBookmaker: document.getElementById("filter-bookmaker"),
  filterMarket: document.getElementById("filter-market"),
  filterType: document.getElementById("filter-type"),
  filterSearch: document.getElementById("filter-search"),
  clearFilters: document.getElementById("clear-filters"),
  exportBtn: document.getElementById("export-btn"),
  tableHead: document.getElementById("table-head"),
  tableColgroup: document.getElementById("table-colgroup"),
  tableBody: document.getElementById("table-body"),
  statTotal: document.getElementById("stat-total"),
  statVisible: document.getElementById("stat-visible"),
  statSource: document.getElementById("stat-source"),
  errors: document.getElementById("errors"),
  empty: document.getElementById("empty-state"),
};

function uniqueValues(key) {
  return [...new Set(allRows.map((row) => row[key]).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
}

function populateFilters() {
  fillSelect(els.filterBookmaker, uniqueValues("bookmaker"), "Todas");
  fillSelect(els.filterMarket, uniqueValues("market"), "Todos");
}

function fillSelect(select, values, allLabel) {
  const current = select.value;
  select.innerHTML = `<option value="">${allLabel}</option>`;
  for (const value of values) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    select.appendChild(option);
  }
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function getFilteredRows() {
  const bookmaker = els.filterBookmaker.value.trim().toLowerCase();
  const market = els.filterMarket.value.trim().toLowerCase();
  const logType = els.filterType.value.trim().toLowerCase();
  const search = els.filterSearch.value.trim().toLowerCase();

  return allRows.filter((row) => {
    if (bookmaker && String(row.bookmaker || "").toLowerCase() !== bookmaker) return false;
    if (market && String(row.market || "").toLowerCase() !== market) return false;
    if (logType && String(row.log_type || "").toLowerCase() !== logType) return false;
    if (search) {
      const haystack = [
        ...DISPLAY_COLUMNS.map((col) => getCellValue(row, col) ?? ""),
        row.home_team ?? "",
        row.away_team ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function getCellValue(row, col) {
  if (col.key === "matchup") {
    if (row.home_team && row.away_team) return `${row.home_team} v ${row.away_team}`;
    return row.home_team || row.away_team || null;
  }
  return row[col.key];
}

function columnHasData(rows, col) {
  if (col.virtual && col.key === "matchup") {
    return rows.some((row) => row.home_team || row.away_team);
  }
  return rows.some((row) => {
    const value = row[col.key];
    return value != null && String(value).trim() !== "";
  });
}

function getActiveColumns(rows) {
  return DISPLAY_COLUMNS.filter(
    (col) => ALWAYS_VISIBLE_COLUMNS.has(col.key) || columnHasData(rows, col),
  );
}

function buildColgroup(columns) {
  const totalWeight = columns.reduce((sum, col) => sum + (col.weight || 8), 0);
  return columns
    .map((col) => {
      const width = (((col.weight || 8) / totalWeight) * 100).toFixed(2);
      return `<col class="${col.className}" style="width:${width}%" />`;
    })
    .join("");
}

function formatCellDisplay(key, value) {
  if (value == null || value === "") {
    const isOdds = key.startsWith("odd_") || key === "line_parameter";
    return { text: isOdds ? "" : "—", title: "", empty: true };
  }

  const text = String(value);

  if (key === "timestamp") {
    const timePart = text.includes("T") ? text.split("T")[1]?.slice(0, 8) : text.slice(0, 8);
    return { text: timePart || text, title: text, empty: false };
  }

  if (key === "msg_guid") {
    const compact = text.replace(/\s+/g, "");
    return {
      text: compact.length > 12 ? `${compact.slice(0, 12)}…` : compact,
      title: text,
      empty: false,
    };
  }

  if (key === "matchup" || key === "market" || key === "competition" || key === "bookmaker") {
    return { text, title: text.length > 24 ? text : "", empty: false };
  }

  return { text, title: "", empty: false };
}

function renderTable() {
  const visibleRows = getFilteredRows();
  const activeColumns = getActiveColumns(visibleRows);

  els.statTotal.textContent = String(allRows.length);
  els.statVisible.textContent = String(visibleRows.length);
  els.statSource.textContent = sourceLabel || "—";

  els.tableColgroup.innerHTML = buildColgroup(activeColumns);

  els.tableHead.innerHTML = activeColumns
    .map((col) => {
      const hint = col.hint || col.label;
      return `<th class="${col.className}" title="${escapeHtml(hint)}">${col.label}</th>`;
    })
    .join("");

  if (!visibleRows.length) {
    els.tableBody.innerHTML = "";
    els.empty.hidden = allRows.length === 0;
    els.exportBtn.disabled = allRows.length === 0;
    return;
  }

  els.empty.hidden = true;
  els.exportBtn.disabled = false;

  els.tableBody.innerHTML = visibleRows
    .map((row) => {
      const cells = activeColumns
        .map((col) => {
          const value = getCellValue(row, col);
          const className = col.className;

          if (col.key === "log_type" && value) {
            const short = value === "replicator" ? "rep" : value === "scanner" ? "scan" : value;
            return `<td class="${className}"><span class="badge ${value}" title="${escapeHtml(value)}">${escapeHtml(short)}</span></td>`;
          }

          if (col.key === "msg_guid") {
            const display = formatCellDisplay(col.key, value);
            const titleAttr = display.title ? ` title="${escapeHtml(display.title)}"` : "";
            const emptyClass = display.empty ? " cell-empty" : "";
            const guid = value ? String(value).replace(/\s+/g, "") : "";
            const copyBtn = guid ? copyGuidButton(guid) : "";
            return `<td class="${className}${emptyClass}"><span class="guid-cell"${titleAttr}><span class="guid-text">${escapeHtml(display.text)}</span>${copyBtn}</span></td>`;
          }

          const display = formatCellDisplay(col.key, value);
          const titleAttr = display.title ? ` title="${escapeHtml(display.title)}"` : "";
          const emptyClass = display.empty ? " cell-empty" : "";
          return `<td class="${className}${emptyClass}"${titleAttr}>${escapeHtml(display.text)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showErrors(errors) {
  if (!errors.length) {
    els.errors.textContent = "";
    els.errors.hidden = true;
    return;
  }
  els.errors.hidden = false;
  els.errors.textContent = errors.slice(0, 8).join("\n");
}

async function handleFile(file) {
  const text = await file.text();
  const csvRows = parseCsv(text);
  if (!csvRows.length) {
    showErrors(["CSV vazio ou inválido."]);
    return;
  }

  /** @type {import("./normalizer.js").NormalizedRow[]} */
  let rows = [];
  /** @type {string[]} */
  let errors = [];

  if (isRawCoralogixExport(csvRows)) {
    const result = normalizeCoralogixRows(csvRows);
    rows = result.rows;
    errors = result.errors;
    sourceLabel = `Bruto (${file.name})`;
  } else if (isNormalizedExport(csvRows)) {
    rows = loadNormalizedRows(csvRows);
    sourceLabel = `Normalizado (${file.name})`;
  } else {
    showErrors(["Formato não reconhecido. Use export Coralogix (Source) ou CSV normalizado."]);
    return;
  }

  allRows = rows;
  showErrors(errors);
  populateFilters();
  renderTable();
}

function setupDropzone() {
  els.dropzone.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files?.[0];
    if (file) handleFile(file);
  });

  els.dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.dropzone.classList.add("dragover");
  });

  els.dropzone.addEventListener("dragleave", () => {
    els.dropzone.classList.remove("dragover");
  });

  els.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("dragover");
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
}

const COPY_ICON = `<svg class="copy-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const CHECK_ICON = `<svg class="copy-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>`;

function copyGuidButton(guid) {
  return `<button type="button" class="copy-guid-btn" data-guid="${escapeHtml(guid)}" title="Copiar GUID" aria-label="Copiar GUID">${COPY_ICON}</button>`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  }
}

function setupCopyGuid() {
  els.tableBody.addEventListener("click", async (event) => {
    const button = event.target.closest(".copy-guid-btn");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const guid = button.dataset.guid;
    if (!guid) return;

    const copied = await copyText(guid);
    if (!copied) return;

    const original = button.innerHTML;
    button.innerHTML = CHECK_ICON;
    button.classList.add("copied");
    window.setTimeout(() => {
      button.innerHTML = original;
      button.classList.remove("copied");
    }, 1200);
  });
}

function setupFilters() {
  for (const element of [
    els.filterBookmaker,
    els.filterMarket,
    els.filterType,
    els.filterSearch,
  ]) {
    element.addEventListener("input", renderTable);
    element.addEventListener("change", renderTable);
  }

  els.clearFilters.addEventListener("click", () => {
    els.filterBookmaker.value = "";
    els.filterMarket.value = "";
    els.filterType.value = "";
    els.filterSearch.value = "";
    renderTable();
  });
}

els.exportBtn.addEventListener("click", () => {
  const visibleRows = getFilteredRows();
  const columns = Object.keys(allRows[0] || {});
  downloadCsv(rowsToCsv(visibleRows, columns), "coralogix_filtered.csv");
});

setupDropzone();
setupCopyGuid();
setupFilters();
renderTable();
