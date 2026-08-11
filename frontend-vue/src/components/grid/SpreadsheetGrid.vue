<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Filter, Redo2, Undo2 } from "@lucide/vue";
import { cloneJson } from "../../domain/clone";
import { applySpreadsheetPaste } from "../../domain/spreadsheet";
import { parseTsv, toTsv } from "../../domain/tsv";

export interface GridOption { value: string; label: string; aliases?: string[] }
export interface GridColumn { key: string; label: string; width?: number; readonly?: boolean; options?: GridOption[]; defaultValue?: unknown; action?: boolean; sticky?: boolean; highlightEmpty?: boolean }
type Row = Record<string, unknown>;

const props = defineProps<{ columns: GridColumn[]; rows: Row[]; rowKey?: string; selectedRows?: string[]; selectAllRows?: boolean; emptyHint?: string; autoCommit?: boolean; readonly?: boolean; filterable?: boolean; filteredColumns?: string[] }>();
const emit = defineEmits<{ commit: [rows: Row[], rowIndexes: number[]]; rowSelect: [id: string, additive: boolean]; rowSelection: [ids: string[]]; cellAction: [row: Row, key: string]; addRow: []; columnFilter: [key: string, event: MouseEvent] }>();

let draftKey = 0;
const historyLimit = 50;
function withDraftKeys(rows: Row[]): Row[] {
  return cloneJson(rows).map((row): Row => ({
    ...row,
    __gridKey: row.__gridKey ?? `grid-${++draftKey}`,
  }));
}

const draft = ref<Row[]>(withDraftKeys(props.rows));
const sheetElement = ref<HTMLElement | null>(null);
const active = ref({ row: 0, col: 0 });
const anchor = ref({ row: 0, col: 0 });
const editing = ref(false);
const editSnapshot = ref<Row[] | null>(null);
const draggingCells = ref(false);
const lastSelectedRow = ref<number | null>(null);
const widths = ref<Record<string, number>>({});
const undoStack = ref<Row[][]>([]);
const redoStack = ref<Row[][]>([]);

const structureKey = computed(() => JSON.stringify({
  columns: props.columns.map((column) => column.key),
  rows: props.rows.map((row, index) => String(row[props.rowKey ?? "id"] ?? `draft-${index}`)),
}));
watch(structureKey, () => {
  const currentById = new Map(draft.value.flatMap((row) => row[props.rowKey ?? "id"]
    ? [[String(row[props.rowKey ?? "id"]), row] as const]
    : []));
  const incoming = withDraftKeys(props.rows).map((row) => currentById.get(String(row[props.rowKey ?? "id"] ?? "")) ?? row);
  const unsaved = draft.value.filter((row) => !row[props.rowKey ?? "id"]);
  draft.value = [...incoming, ...unsaved.filter((row) => !incoming.some((item) => item.__gridKey === row.__gridKey))];
  undoStack.value = [];
  redoStack.value = [];
  editSnapshot.value = null;
});

const selected = computed(() => ({
  r1: Math.min(active.value.row, anchor.value.row), r2: Math.max(active.value.row, anchor.value.row),
  c1: Math.min(active.value.col, anchor.value.col), c2: Math.max(active.value.col, anchor.value.col),
}));
const selectedCellCount = computed(() => (
  (selected.value.r2 - selected.value.r1 + 1) * (selected.value.c2 - selected.value.c1 + 1)
));
const selectableRowIds = computed(() => draft.value
  .map((row) => String(row[props.rowKey ?? "id"] ?? ""))
  .filter(Boolean));
const selectedVisibleCount = computed(() => {
  const current = new Set(props.selectedRows ?? []);
  return selectableRowIds.value.filter((id) => current.has(id)).length;
});
const allRowsSelected = computed(() => Boolean(
  selectableRowIds.value.length && selectedVisibleCount.value === selectableRowIds.value.length,
));
const gridColumns = computed(() => `64px ${props.columns.map((column) => `${widths.value[column.key] ?? column.width ?? 150}px`).join(" ")}`);

function stickyLeft(colIndex: number) {
  return 64 + props.columns.slice(0, colIndex).reduce(
    (total, column) => total + (widths.value[column.key] ?? column.width ?? 150),
    0,
  );
}
function isSelected(row: number, col: number) {
  const range = selected.value;
  return row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2;
}
function activate(row: number, col: number, extend = false) {
  active.value = { row, col };
  if (!extend) anchor.value = { row, col };
}
function stopCellDrag() {
  draggingCells.value = false;
  window.removeEventListener("pointerup", stopCellDrag);
}
function startCellDrag(row: number, col: number, event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest("input, select, button")) return;
  sheetElement.value?.focus({ preventScroll: true });
  activate(row, col, event.shiftKey);
  draggingCells.value = true;
  window.addEventListener("pointerup", stopCellDrag);
  event.preventDefault();
}
function extendCellDrag(row: number, col: number) {
  if (draggingCells.value) active.value = { row, col };
}
function selectColumn(col: number) {
  anchor.value = { row: 0, col };
  active.value = { row: Math.max(0, draft.value.length - 1), col };
}
function selectRow(row: number, event: MouseEvent) {
  anchor.value = { row, col: 0 };
  active.value = { row, col: Math.max(0, props.columns.length - 1) };
  const id = String(draft.value[row]?.[props.rowKey ?? "id"] ?? "");
  if (!id) return;
  if (event.shiftKey && lastSelectedRow.value !== null) {
    const start = Math.min(lastSelectedRow.value, row);
    const end = Math.max(lastSelectedRow.value, row);
    emit("rowSelection", draft.value.slice(start, end + 1).map((item) => String(item[props.rowKey ?? "id"] ?? "")).filter(Boolean));
  } else emit("rowSelect", id, event.ctrlKey || event.metaKey);
  lastSelectedRow.value = row;
}
function toggleRow(row: number) {
  const id = String(draft.value[row]?.[props.rowKey ?? "id"] ?? "");
  if (!id) return;
  const current = new Set(props.selectedRows ?? []);
  if (current.has(id)) current.delete(id); else current.add(id);
  emit("rowSelection", [...current]);
  lastSelectedRow.value = row;
}
function selectAll() {
  anchor.value = { row: 0, col: 0 };
  active.value = { row: Math.max(0, draft.value.length - 1), col: Math.max(0, props.columns.length - 1) };
}
function toggleAllRows() { emit("rowSelection", allRowsSelected.value ? [] : selectableRowIds.value) }
function move(rowDelta: number, colDelta: number, extend = false) {
  activate(
    Math.max(0, Math.min(draft.value.length - 1, active.value.row + rowDelta)),
    Math.max(0, Math.min(props.columns.length - 1, active.value.col + colDelta)),
    extend,
  );
}
function moveLinear(direction: 1 | -1) {
  if (!draft.value.length || !props.columns.length) return;
  const next = active.value.row * props.columns.length + active.value.col + direction;
  const clamped = Math.max(0, Math.min(draft.value.length * props.columns.length - 1, next));
  activate(Math.floor(clamped / props.columns.length), clamped % props.columns.length);
}

function rowsEqual(left: Row[], right: Row[]) { return JSON.stringify(left) === JSON.stringify(right) }
function changedRowIndexes(before: Row[], after: Row[]) {
  const indexes: number[] = [];
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (JSON.stringify(before[index]) !== JSON.stringify(after[index])) indexes.push(index);
  }
  return indexes;
}
function pushUndo(snapshot: Row[]) {
  if (snapshot.length !== draft.value.length || rowsEqual(snapshot, draft.value)) return;
  undoStack.value.push(snapshot);
  if (undoStack.value.length > historyLimit) undoStack.value.shift();
  redoStack.value = [];
}
function beginEditHistory() { editSnapshot.value = cloneJson(draft.value) }
function finishEditHistory() {
  if (!editSnapshot.value) return;
  pushUndo(editSnapshot.value);
  editSnapshot.value = null;
}
function emitChangedRows(before: Row[], after: Row[]) {
  if (!props.autoCommit) return;
  const indexes = changedRowIndexes(before, after).filter((index) => after[index]);
  if (indexes.length) emit("commit", indexes.map((index) => cloneJson(after[index])), indexes);
}
function restoreHistory(source: typeof undoStack, destination: typeof redoStack) {
  if (props.readonly || !source.value.length) return;
  const current = cloneJson(draft.value);
  const snapshot = source.value.pop();
  if (!snapshot) return;
  destination.value.push(current);
  if (destination.value.length > historyLimit) destination.value.shift();
  draft.value = withDraftKeys(snapshot);
  editing.value = false;
  editSnapshot.value = null;
  active.value.row = Math.min(active.value.row, Math.max(0, draft.value.length - 1));
  anchor.value = { ...active.value };
  emitChangedRows(current, draft.value);
  void nextTick(() => sheetElement.value?.focus({ preventScroll: true }));
}
function undo() { restoreHistory(undoStack, redoStack) }
function redo() { restoreHistory(redoStack, undoStack) }

async function copy(cut = false) {
  const range = selected.value;
  const rows = draft.value.slice(range.r1, range.r2 + 1).map((row) => props.columns.slice(range.c1, range.c2 + 1).map((column) => row[column.key]));
  await navigator.clipboard.writeText(toTsv(rows));
  if (cut) clearSelection();
}
function clearSelection() {
  if (props.readonly) return;
  const before = cloneJson(draft.value);
  const range = selected.value;
  for (let row = range.r1; row <= range.r2; row += 1) {
    for (let col = range.c1; col <= range.c2; col += 1) {
      const column = props.columns[col];
      if (column && !column.readonly) draft.value[row][column.key] = column.defaultValue ?? "";
    }
  }
  pushUndo(before);
  emitChangedRows(before, draft.value);
}
function fillSelection() {
  if (props.readonly || !draft.value[anchor.value.row]) return;
  const sourceColumn = props.columns[anchor.value.col];
  if (!sourceColumn || sourceColumn.readonly) return;
  const before = cloneJson(draft.value);
  const value = draft.value[anchor.value.row][sourceColumn.key];
  const range = selected.value;
  for (let row = range.r1; row <= range.r2; row += 1) {
    for (let col = range.c1; col <= range.c2; col += 1) {
      const target = props.columns[col];
      if (!target?.readonly && (!target.options || target.options.some((option) => option.value === value))) {
        draft.value[row][target.key] = value;
      }
    }
  }
  pushUndo(before);
  emitChangedRows(before, draft.value);
}
function onPaste(event: ClipboardEvent) {
  if (props.readonly) return;
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return;
  const cells = parseTsv(text);
  if (!cells.length) return;
  const target = event.target as HTMLElement;
  const isSingleEditorCell = target.matches("input, textarea") && cells.length === 1 && cells[0].length === 1;
  if (isSingleEditorCell) return;
  event.preventDefault();
  const before = cloneJson(draft.value);
  editing.value = false;
  editSnapshot.value = null;
  draft.value = withDraftKeys(applySpreadsheetPaste(draft.value, props.columns, active.value.row, active.value.col, cells));
  anchor.value = { ...active.value };
  active.value = {
    row: active.value.row + cells.length - 1,
    col: Math.min(props.columns.length - 1, active.value.col + Math.max(...cells.map((row) => row.length)) - 1),
  };
  pushUndo(before);
  emitChangedRows(before, draft.value);
}

function onKey(event: KeyboardEvent) {
  if (editing.value) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "z") {
    if (event.shiftKey) redo(); else undo();
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (command && event.key.toLowerCase() === "y") { redo(); event.preventDefault(); event.stopPropagation(); return }
  if (command && event.key.toLowerCase() === "c") { void copy(); event.preventDefault(); return }
  if (command && event.key.toLowerCase() === "x") { void copy(true); event.preventDefault(); return }
  if (command && event.key === "Enter") { fillSelection(); event.preventDefault(); return }
  if (event.key === "Delete") { clearSelection(); event.preventDefault(); return }
  if (event.key === "F2" || event.key === "Enter") {
    const column = props.columns[active.value.col];
    if (column && !column.readonly && !column.options) {
      beginEditing(active.value.row, active.value.col);
      event.preventDefault();
      return;
    }
  }
  if (event.key.length === 1 && !command && !event.altKey && !props.columns[active.value.col]?.readonly) {
    const column = props.columns[active.value.col];
    if (column && !column.options && draft.value[active.value.row]) {
      beginEditing(active.value.row, active.value.col);
      draft.value[active.value.row][column.key] = event.key;
    }
    event.preventDefault();
    return;
  }
  const moves: Record<string, [number, number]> = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    Tab: [0, event.shiftKey ? -1 : 1], Enter: [event.shiftKey ? -1 : 1, 0],
  };
  if (moves[event.key]) {
    if (event.key === "Tab") moveLinear(event.shiftKey ? -1 : 1);
    else move(...moves[event.key], event.shiftKey && event.key.startsWith("Arrow"));
    event.preventDefault();
  }
}

function resize(column: GridColumn, event: PointerEvent) {
  const start = event.clientX;
  const initial = widths.value[column.key] ?? column.width ?? 150;
  const moveColumn = (next: PointerEvent) => { widths.value[column.key] = Math.max(72, initial + next.clientX - start) };
  const up = () => {
    window.removeEventListener("pointermove", moveColumn);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", moveColumn);
  window.addEventListener("pointerup", up);
}
function autoFit(column: GridColumn) {
  const longest = Math.max(column.label.length, ...draft.value.map((row) => String(row[column.key] ?? "").length));
  widths.value[column.key] = Math.min(360, Math.max(72, longest * 9 + 28));
}
function focusEditor() {
  (sheetElement.value?.querySelector(".sheet-cell.editing input") as HTMLInputElement | null)?.focus();
}
function beginEditing(row: number, col: number) {
  const column = props.columns[col];
  if (props.readonly || column?.readonly || column?.options || !draft.value[row]) return;
  activate(row, col);
  beginEditHistory();
  editing.value = true;
  void nextTick(focusEditor);
}
function editCell(row: number, col: number) { beginEditing(row, col) }
function commit() { emit("commit", cloneJson(draft.value), draft.value.map((_row, index) => index)) }
function commitRow(row: number) {
  if (props.autoCommit && draft.value[row]) emit("commit", [cloneJson(draft.value[row])], [row]);
}
function finishEditing(row: number, focusSheet = false) {
  if (!editing.value) return;
  editing.value = false;
  finishEditHistory();
  commitRow(row);
  if (focusSheet) void nextTick(() => sheetElement.value?.focus({ preventScroll: true }));
}
function cancelEditing() {
  if (!editing.value) return;
  if (editSnapshot.value) draft.value = editSnapshot.value;
  editSnapshot.value = null;
  editing.value = false;
  void nextTick(() => sheetElement.value?.focus({ preventScroll: true }));
}
function completeEditing(row: number, key: "Enter" | "Tab", backwards = false) {
  finishEditing(row);
  if (key === "Enter") move(backwards ? -1 : 1, 0);
  else moveLinear(backwards ? -1 : 1);
  void nextTick(() => sheetElement.value?.focus({ preventScroll: true }));
}
function beginSelectEdit(row: number, col: number) {
  activate(row, col);
  beginEditHistory();
}
function commitSelect(row: number) {
  finishEditHistory();
  commitRow(row);
}
function addDraftRow() {
  if (props.readonly) return;
  draft.value.push({
    ...Object.fromEntries(props.columns.map((column) => [column.key, column.defaultValue ?? ""])),
    __gridKey: `grid-${++draftKey}`,
  });
  active.value = { row: draft.value.length - 1, col: 0 };
  anchor.value = { ...active.value };
  beginEditHistory();
  editing.value = true;
  void nextTick(focusEditor);
  emit("addRow");
}
function refresh() {
  draft.value = withDraftKeys(props.rows);
  undoStack.value = [];
  redoStack.value = [];
  editSnapshot.value = null;
}
function acceptSavedRow(rowIndex: number, committed: Row, saved: Row) {
  const current = draft.value[rowIndex];
  if (!current || current.__gridKey !== committed.__gridKey) return;
  for (const [key, value] of Object.entries(saved)) {
    if (key === (props.rowKey ?? "id") || current[key] === committed[key]) current[key] = value;
  }
}

defineExpose({ addDraftRow, refresh, acceptSavedRow, undo, redo });
onBeforeUnmount(stopCellDrag);
</script>

<template>
  <div class="sheet-command-bar">
    <div class="sheet-history-actions">
      <button type="button" :disabled="readonly || !undoStack.length" title="셀 편집 실행 취소" aria-label="셀 편집 실행 취소" @click="undo"><Undo2 :size="15"/></button>
      <button type="button" :disabled="readonly || !redoStack.length" title="셀 편집 다시 실행" aria-label="셀 편집 다시 실행" @click="redo"><Redo2 :size="15"/></button>
    </div>
    <span v-if="selectedCellCount > 1" class="sheet-selection-count">{{ selectedCellCount }}개 셀 선택</span>
  </div>
  <div ref="sheetElement" class="sheet" tabindex="0" @keydown="onKey" @paste="onPaste">
    <div class="sheet-row sheet-header" :style="{ gridTemplateColumns: gridColumns }">
      <div class="sheet-head row-number" @click="selectAll">
        <button
          v-if="selectAllRows"
          type="button"
          class="sheet-select-all"
          title="전체 행 선택"
          aria-label="전체 행 선택"
          :aria-checked="allRowsSelected ? 'true' : selectedVisibleCount ? 'mixed' : 'false'"
          role="checkbox"
          @click.stop="toggleAllRows"
        ><span class="row-check" :class="{ checked: allRowsSelected || selectedVisibleCount }">{{ allRowsSelected ? '✓' : selectedVisibleCount ? '−' : '' }}</span></button>
        <template v-else>#</template>
      </div>
      <div v-for="(column, colIndex) in columns" :key="column.key" class="sheet-head" :class="{ 'sticky-column': column.sticky }" :style="column.sticky ? { left: `${stickyLeft(colIndex)}px` } : undefined" @click="selectColumn(colIndex)" @dblclick="autoFit(column)">
        <span class="sheet-head-label">{{ column.label }}</span>
        <button
          v-if="filterable"
          type="button"
          class="sheet-filter-button"
          :class="{ active: filteredColumns?.includes(column.key) }"
          :title="`${column.label} 필터`"
          :aria-label="`${column.label} 필터`"
          @click.stop="emit('columnFilter', column.key, $event)"
          @dblclick.stop
        ><Filter :size="13"/></button>
        <span class="column-resizer" @pointerdown.stop="resize(column, $event)" />
      </div>
    </div>
    <div v-for="(row, rowIndex) in draft" :key="String(row[rowKey ?? 'id'] ?? row.__gridKey ?? rowIndex)" class="sheet-row" :class="{ 'row-selected': selectedRows?.includes(String(row[rowKey ?? 'id'])) }" :style="{ gridTemplateColumns: gridColumns }">
      <button type="button" class="sheet-row-number" @click="selectRow(rowIndex, $event)"><span class="row-check" :class="{ checked: selectedRows?.includes(String(row[rowKey ?? 'id'])) }" role="checkbox" :aria-checked="selectedRows?.includes(String(row[rowKey ?? 'id']))" @click.stop="toggleRow(rowIndex)">✓</span><span>{{ rowIndex + 1 }}</span></button>
      <div v-for="(column, colIndex) in columns" :key="column.key" class="sheet-cell" :class="{ selected: isSelected(rowIndex, colIndex), active: active.row === rowIndex && active.col === colIndex, editing: editing && active.row === rowIndex && active.col === colIndex, 'sticky-column': column.sticky, 'missing-value': column.highlightEmpty && !String(row[column.key] ?? '').trim() }" :style="column.sticky ? { left: `${stickyLeft(colIndex)}px` } : undefined" @pointerdown="startCellDrag(rowIndex, colIndex, $event)" @pointerenter="extendCellDrag(rowIndex, colIndex)" @dblclick="editCell(rowIndex, colIndex)">
        <button v-if="column.action" type="button" class="sheet-cell-action" :disabled="readonly" @mousedown.stop @click.stop="emit('cellAction', cloneJson(row), column.key)"><span>{{ row[column.key] || '선택' }}</span><b>›</b></button>
        <select v-else-if="column.options && !column.readonly" v-model="row[column.key] as string" class="sheet-inline-select" :disabled="readonly" @pointerdown.stop="beginSelectEdit(rowIndex, colIndex)" @click.stop @change="commitSelect(rowIndex)"><option v-for="option in column.options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
        <input
          v-else-if="editing && active.row === rowIndex && active.col === colIndex && !column.readonly"
          v-model="row[column.key] as string"
          :disabled="readonly"
          @blur="finishEditing(rowIndex)"
          @keydown.enter.stop.prevent="completeEditing(rowIndex, 'Enter', $event.shiftKey)"
          @keydown.tab.stop.prevent="completeEditing(rowIndex, 'Tab', $event.shiftKey)"
          @keydown.esc.stop.prevent="cancelEditing"
        />
        <span v-else>{{ row[column.key] }}</span>
      </div>
    </div>
    <div v-if="!draft.length" class="sheet-empty">{{ emptyHint || '행이 없습니다.' }}</div>
  </div>
  <div v-if="!autoCommit" class="sheet-actions">
    <button type="button" @click="addDraftRow">행 추가</button>
    <button type="button" class="primary" @click="commit">변경사항 저장</button>
  </div>
</template>
