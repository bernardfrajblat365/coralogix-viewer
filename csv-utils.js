/**
 * Minimal RFC4180 CSV parser for quoted fields.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else if (char === "\r") {
      // ignore
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((cells) => {
    /** @type {Record<string, string>} */
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = cells[index] ?? "";
    });
    return obj;
  });
}

/**
 * @param {Record<string, string | null>[]} rows
 * @param {string[]} columns
 */
export function rowsToCsv(rows, columns) {
  const escape = (value) => {
    const text = value == null ? "" : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((col) => escape(row[col])).join(","));
  }
  return lines.join("\n");
}

/**
 * @param {string} csv
 * @param {string} filename
 */
export function downloadCsv(csv, filename) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
