import {
  ALWAYS_VISIBLE_COLUMNS,
  DISPLAY_COLUMNS,
  getNamedSelections,
  isNormalizedExport,
  isPlayerPropMarket,
  isRawCoralogixExport,
  loadNormalizedRows,
  normalizeCoralogixRows,
} from "./normalizer.js";
import { downloadCsv, parseCsv, rowsToCsv } from "./csv-utils.js";
import { createMultiSelectDropdown } from "./multi-select-dropdown.js";

/** @type {import("./normalizer.js").NormalizedRow[]} */
let allRows = [];
/** @type {string} */
let sourceLabel = "";
/** @type {Set<string>} */
let expandedRowKeys = new Set();
/** @type {boolean} */
let hideProps = false;

/** @type {ReturnType<typeof createMultiSelectDropdown> | null} */
let filterBookmaker = null;
/** @type {ReturnType<typeof createMultiSelectDropdown> | null} */
let filterMarket = null;
/** @type {ReturnType<typeof createMultiSelectDropdown> | null} */
let filterType = null;

const els = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  filterBookmakerRoot: document.getElementById("filter-bookmaker"),
  filterMarketRoot: document.getElementById("filter-market"),
  filterTypeRoot: document.getElementById("filter-type"),
  filterSearch: document.getElementById("filter-search"),
  toggleHideProps: document.getElementById("toggle-hide-props"),
  clearFilters: document.getElementById("clear-filters"),
  exportBtn: document.getElementById("export-btn"),
  tableHead: document.getElementById("table-head"),
  tableColgroup: document.getElementById("table-colgroup"),
  tableBody: document.getElementById("table-body"),
  statTotal: document.getElementById("stat-total"),
  statVisible: document.getElementById("stat-visible"),
  statSource: document.getElementById("stat-source"),
  statMatchup: document.getElementById("stat-matchup"),
  statMatchupMeta: document.getElementById("stat-matchup-meta"),
  errors: document.getElementById("errors"),
  empty: document.getElementById("empty-state"),
};

function uniqueValues(key) {
  return [...new Set(allRows.map((row) => row[key]).filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
}

function itemsFromValues(values) {
  return values.map((value) => ({ value: String(value), label: String(value) }));
}

function initFilters() {
  filterBookmaker = createMultiSelectDropdown(els.filterBookmakerRoot, {
    label: "Bookmaker",
    placeholder: "Todas",
    onChange: renderTable,
  });

  filterMarket = createMultiSelectDropdown(els.filterMarketRoot, {
    label: "Mercado",
    placeholder: "Todos",
    onChange: renderTable,
  });

  filterType = createMultiSelectDropdown(els.filterTypeRoot, {
    label: "Tipo de log",
    placeholder: "Todos",
    items: [
      { value: "replicator", label: "replicator" },
      { value: "scanner", label: "scanner" },
    ],
    onChange: renderTable,
  });
}

function populateFilters() {
  filterBookmaker?.setItems(itemsFromValues(uniqueValues("bookmaker")));
  filterMarket?.setItems(itemsFromValues(uniqueValues("market")));
}

function rowKey(row) {
  return [row.timestamp, row.msg_guid, row.market, row.bookmaker, row.fixture_id].join("|");
}

function getFilteredRows() {
  const bookmakers = (filterBookmaker?.getValues() ?? []).map((value) => value.toLowerCase());
  const markets = (filterMarket?.getValues() ?? []).map((value) => value.toLowerCase());
  const logTypes = (filterType?.getValues() ?? []).map((value) => value.toLowerCase());
  const search = els.filterSearch.value.trim().toLowerCase();

  return allRows.filter((row) => {
    if (hideProps && isPlayerPropMarket(row)) return false;
    if (
      bookmakers.length &&
      !bookmakers.includes(String(row.bookmaker || "").toLowerCase())
    ) {
      return false;
    }
    if (markets.length && !markets.includes(String(row.market || "").toLowerCase())) return false;
    if (logTypes.length && !logTypes.includes(String(row.log_type || "").toLowerCase())) {
      return false;
    }
    if (search) {
      const selections = getNamedSelections(row.odds_json)
        .map((item) => item.name)
        .join(" ");
      const haystack = [
        ...DISPLAY_COLUMNS.map((col) => getCellValue(row, col) ?? ""),
        selections,
        row.home_team ?? "",
        row.away_team ?? "",
        row.competition ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function getCellValue(row, col) {
  return row[col.key];
}

function columnHasData(rows, col) {
  return rows.some((row) => {
    if (col.key === "odd_yes" && getNamedSelections(row.odds_json).length > 0) return true;
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

  if (key === "market" || key === "bookmaker") {
    return { text, title: text.length > 24 ? text : "", empty: false };
  }

  return { text, title: "", empty: false };
}

function getFileMatchup() {
  const withBoth = allRows.find((row) => row.home_team && row.away_team);
  if (withBoth) {
    return {
      title: `${withBoth.home_team} v ${withBoth.away_team}`,
      meta: [withBoth.competition, withBoth.fixture_id ? `Fixture ${withBoth.fixture_id}` : null]
        .filter(Boolean)
        .join(" · "),
    };
  }

  const withOne = allRows.find((row) => row.home_team || row.away_team);
  if (withOne) {
    return {
      title: withOne.home_team || withOne.away_team,
      meta: [withOne.competition, withOne.fixture_id ? `Fixture ${withOne.fixture_id}` : null]
        .filter(Boolean)
        .join(" · "),
    };
  }

  const withFixture = allRows.find((row) => row.fixture_id);
  if (withFixture) {
    return {
      title: `Fixture ${withFixture.fixture_id}`,
      meta: withFixture.competition || "",
    };
  }

  return { title: "—", meta: "" };
}

function renderCell(row, col, options = {}) {
  const { selectionName = null, selectionOdd = null, isParent = false, isExpanded = false, selectionsCount = 0 } =
    options;
  const value = selectionName && col.key === "market" ? null : getCellValue(row, col);
  const className = col.className;

  if (col.key === "log_type") {
    if (selectionName) {
      return `<td class="${className} cell-empty"></td>`;
    }
    if (value) {
      const short = value === "replicator" ? "rep" : value === "scanner" ? "scan" : value;
      return `<td class="${className}"><span class="badge ${value}" title="${escapeHtml(value)}">${escapeHtml(short)}</span></td>`;
    }
  }

  if (col.key === "market") {
    if (selectionName) {
      return `<td class="${className}"><span class="market-cell selection-indent"><span class="market-selection">${escapeHtml(selectionName)}</span></span></td>`;
    }

    const marketText = value != null && value !== "" ? String(value) : "—";
    const emptyClass = !value ? " cell-empty" : "";

    if (isParent) {
      const chevron = isExpanded ? "▾" : "▸";
      return `<td class="${className}${emptyClass}"><span class="market-cell market-expandable"><span class="expand-chevron" aria-hidden="true">${chevron}</span><span class="market-name">${escapeHtml(marketText)}</span><span class="selection-count">${selectionsCount}</span></span></td>`;
    }

    return `<td class="${className}${emptyClass}" title="${escapeHtml(marketText)}"><span class="market-cell"><span class="market-name">${escapeHtml(marketText)}</span></span></td>`;
  }

  if (col.key === "odd_yes" && selectionOdd != null) {
    return `<td class="${className}">${escapeHtml(selectionOdd)}</td>`;
  }

  if (col.key === "msg_guid") {
    if (selectionName) {
      return `<td class="${className} cell-empty"></td>`;
    }
    const display = formatCellDisplay(col.key, value);
    const titleAttr = display.title ? ` title="${escapeHtml(display.title)}"` : "";
    const emptyClass = display.empty ? " cell-empty" : "";
    const guid = value ? String(value).replace(/\s+/g, "") : "";
    const copyBtn = guid ? copyGuidButton(guid) : "";
    return `<td class="${className}${emptyClass}"><span class="guid-cell"${titleAttr}><span class="guid-text">${escapeHtml(display.text)}</span>${copyBtn}</span></td>`;
  }

  if (selectionName && (col.key.startsWith("odd_") || col.key === "timestamp" || col.key === "bookmaker" || col.key === "fixture_id" || col.key === "line_parameter")) {
    if (col.key.startsWith("odd_") && col.key !== "odd_yes") {
      return `<td class="${className} cell-empty"></td>`;
    }
    if (col.key !== "odd_yes") {
      return `<td class="${className} cell-empty"></td>`;
    }
  }

  const display = formatCellDisplay(col.key, value);
  const titleAttr = display.title ? ` title="${escapeHtml(display.title)}"` : "";
  const emptyClass = display.empty ? " cell-empty" : "";
  return `<td class="${className}${emptyClass}"${titleAttr}>${escapeHtml(display.text)}</td>`;
}

function renderTable() {
  const visibleRows = getFilteredRows();
  const activeColumns = getActiveColumns(visibleRows);
  const matchup = getFileMatchup();

  els.statTotal.textContent = String(allRows.length);
  els.statVisible.textContent = String(visibleRows.length);
  els.statSource.textContent = sourceLabel || "—";
  els.statMatchup.textContent = matchup.title;
  if (matchup.meta) {
    els.statMatchupMeta.hidden = false;
    els.statMatchupMeta.textContent = matchup.meta;
  } else {
    els.statMatchupMeta.hidden = true;
    els.statMatchupMeta.textContent = "";
  }

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

  const htmlParts = [];

  for (const row of visibleRows) {
    const selections = getNamedSelections(row.odds_json);
    const key = rowKey(row);
    const isParent = selections.length > 0;
    const isExpanded = isParent && expandedRowKeys.has(key);

    const parentCells = activeColumns
      .map((col) =>
        renderCell(row, col, {
          isParent,
          isExpanded,
          selectionsCount: selections.length,
        }),
      )
      .join("");

    const parentClass = [
      isParent ? "row-expandable" : "",
      isExpanded ? "row-expanded" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const parentAttrs = isParent
      ? ` class="${parentClass}" data-row-key="${escapeHtml(key)}" tabindex="0" role="button" aria-expanded="${isExpanded}"`
      : parentClass
        ? ` class="${parentClass}"`
        : "";

    htmlParts.push(`<tr${parentAttrs}>${parentCells}</tr>`);

    if (isExpanded) {
      for (const selection of selections) {
        const childCells = activeColumns
          .map((col) =>
            renderCell(row, col, {
              selectionName: selection.name,
              selectionOdd: selection.odd,
            }),
          )
          .join("");
        htmlParts.push(`<tr class="row-selection">${childCells}</tr>`);
      }
    }
  }

  els.tableBody.innerHTML = htmlParts.join("");
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
  expandedRowKeys = new Set();
  hideProps = false;
  els.toggleHideProps.classList.remove("active");
  els.toggleHideProps.textContent = "Ocultar props";
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

function toggleExpandedRow(key) {
  if (expandedRowKeys.has(key)) expandedRowKeys.delete(key);
  else expandedRowKeys.add(key);
  renderTable();
}

function setupTableInteractions() {
  els.tableBody.addEventListener("click", async (event) => {
    const copyButton = event.target.closest(".copy-guid-btn");
    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();

      const guid = copyButton.dataset.guid;
      if (!guid) return;

      const copied = await copyText(guid);
      if (!copied) return;

      const original = copyButton.innerHTML;
      copyButton.innerHTML = CHECK_ICON;
      copyButton.classList.add("copied");
      window.setTimeout(() => {
        copyButton.innerHTML = original;
        copyButton.classList.remove("copied");
      }, 1200);
      return;
    }

    const expandable = event.target.closest("tr.row-expandable");
    if (!expandable) return;

    const key = expandable.dataset.rowKey;
    if (!key) return;
    toggleExpandedRow(key);
  });

  els.tableBody.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const expandable = event.target.closest("tr.row-expandable");
    if (!expandable) return;
    event.preventDefault();
    const key = expandable.dataset.rowKey;
    if (!key) return;
    toggleExpandedRow(key);
  });
}

function setupFilters() {
  els.filterSearch.addEventListener("input", renderTable);

  els.toggleHideProps.addEventListener("click", () => {
    hideProps = !hideProps;
    els.toggleHideProps.classList.toggle("active", hideProps);
    els.toggleHideProps.textContent = hideProps ? "Mostrar props" : "Ocultar props";
    renderTable();
  });

  els.clearFilters.addEventListener("click", () => {
    filterBookmaker?.clear();
    filterMarket?.clear();
    filterType?.clear();
    els.filterSearch.value = "";
    hideProps = false;
    els.toggleHideProps.classList.remove("active");
    els.toggleHideProps.textContent = "Ocultar props";
    renderTable();
  });
}

els.exportBtn.addEventListener("click", () => {
  const visibleRows = getFilteredRows();
  const columns = Object.keys(allRows[0] || {});
  downloadCsv(rowsToCsv(visibleRows, columns), "coralogix_filtered.csv");
});

setupDropzone();
setupTableInteractions();
initFilters();
setupFilters();
renderTable();
