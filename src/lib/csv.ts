import Papa from "papaparse";

/** Build CSV text with a UTF-8 BOM so Excel opens accented names correctly. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const fields = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const safe = rows.map((r) =>
    Object.fromEntries(
      fields.map((f) => {
        const v = r[f];
        const s = v === null || v === undefined ? "" : String(v);
        // Neutralise spreadsheet formula injection.
        return [f, /^[=+\-@]/.test(s) ? `'${s}` : s];
      }),
    ),
  );
  return "﻿" + Papa.unparse({ fields, data: safe.map((r) => fields.map((f) => r[f])) });
}

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns?: string[]) {
  downloadText(filename, toCsv(rows, columns));
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export";
}
