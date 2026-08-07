export interface SpreadsheetPasteOption { value: string; label: string; aliases?: string[] }
export interface SpreadsheetPasteColumn {
  key: string;
  readonly?: boolean;
  defaultValue?: unknown;
  options?: SpreadsheetPasteOption[];
}

export function applySpreadsheetPaste(
  sourceRows: Array<Record<string, unknown>>,
  columns: SpreadsheetPasteColumn[],
  startRow: number,
  startCol: number,
  cells: string[][],
): Array<Record<string, unknown>> {
  const rows = sourceRows.map((row) => ({ ...row }));
  while (rows.length < startRow + cells.length) {
    rows.push(Object.fromEntries(columns.map((column) => [column.key, column.defaultValue ?? ""])));
  }
  cells.forEach((values, rowOffset) => values.forEach((rawValue, colOffset) => {
    const column = columns[startCol + colOffset];
    if (!column || column.readonly) return;
    const normalizedValue = rawValue.trim().toLocaleLowerCase("ko");
    const option = column.options?.find((item) => (
      [item.value, item.label, ...(item.aliases ?? [])]
        .some((candidate) => candidate.trim().toLocaleLowerCase("ko") === normalizedValue)
    ));
    if (column.options && !option) return;
    rows[startRow + rowOffset][column.key] = option?.value ?? rawValue;
  }));
  return rows;
}
