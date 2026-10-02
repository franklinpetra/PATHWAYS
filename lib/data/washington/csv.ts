/** RFC 4180 parsing for CSV and tab-delimited exports. Pure; no dependencies. */

export interface ParsedRecord {
  /** 1-based line number of the record's first line in the file, for error reports. */
  line: number;
  values: Record<string, string>;
}

export interface ParsedFile {
  headers: string[];
  records: ParsedRecord[];
}

/** Tab-delimited if the header line has more tabs than commas. */
export function detectDelimiter(text: string): "," | "\t" {
  const header = text.slice(0, text.search(/\r?\n|$/));
  return (header.match(/\t/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? "\t" : ",";
}

export function parseDelimited(text: string, delimiter = detectDelimiter(text)): ParsedFile {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;

  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        if (c === "\n") line++;
        cell += c;
      }
    } else if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === delimiter) {
      cells.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      cells.push(cell);
      rows.push({ line: rowStart, cells });
      cells = [];
      cell = "";
      line++;
      rowStart = line;
    } else {
      cell += c;
    }
  }
  if (cell !== "" || cells.length > 0) {
    cells.push(cell);
    rows.push({ line: rowStart, cells });
  }

  const nonEmpty = rows.filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], records: [] };
  const [head, ...body] = nonEmpty;
  const headers = head.cells.map((h) => h.trim());
  return {
    headers,
    records: body.map((r) => ({
      line: r.line,
      values: Object.fromEntries(headers.map((h, i) => [h, (r.cells[i] ?? "").trim()])),
    })),
  };
}
