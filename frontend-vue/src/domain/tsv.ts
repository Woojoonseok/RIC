export function parseTsv(value: string): string[][] {
  const normalized = value.replace(/\r\n?/g, "\n");
  if (!normalized) return [];
  return normalized.split("\n").filter((line, index, rows) => line.length > 0 || index < rows.length - 1).map((line) => line.split("\t"));
}

export function toTsv(rows: unknown[][]): string {
  return rows.map((row) => row.map((cell) => String(cell ?? "").replace(/[\t\r\n]+/g, " ")).join("\t")).join("\r\n");
}
