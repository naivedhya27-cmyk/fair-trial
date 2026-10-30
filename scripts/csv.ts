// Small CSV helpers for the validation scripts (RFC 4180: quoted fields may hold commas, doubled quotes, line breaks).
import fs from "node:fs";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}

/** Rows as objects keyed by the header. */
export function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, "utf8");
  const [head, ...body] = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  return body.filter((r) => r.length > 1 || r[0]).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

export function writeCsv(file: string, header: string[], rows: unknown[][]): void {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  fs.writeFileSync(file, [header.join(","), ...rows.map((r) => r.map(q).join(","))].join("\n") + "\n");
}
