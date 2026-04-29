// Memory commands output JSON whenever the parent process passes --json.
// commander parses the flag at the program level; for now memory commands are
// human-formatted by default. If we ever wire JSON-mode globally, flip this.
const jsonMode = false;

export function isJson() {
  return jsonMode;
}

export function printJson(data: unknown) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function printText(text: string) {
  process.stdout.write(`${text}\n`);
}

export function printError(message: string) {
  process.stderr.write(`error: ${message}\n`);
}

export function printTable(headers: string[], rows: string[][]) {
  if (jsonMode) return;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] || "").length))
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  process.stdout.write(`${line(headers)}\n`);
  process.stdout.write(`${widths.map((w) => "-".repeat(w)).join("  ")}\n`);
  for (const row of rows) {
    process.stdout.write(`${line(row)}\n`);
  }
}
