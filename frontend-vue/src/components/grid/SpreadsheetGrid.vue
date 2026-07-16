<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { cloneJson } from "../../domain/clone";
import { parseTsv, toTsv } from "../../domain/tsv";

export interface GridOption { value: string; label: string }
export interface GridColumn { key: string; label: string; width?: number; readonly?: boolean; options?: GridOption[]; defaultValue?: unknown }
const props = defineProps<{ columns: GridColumn[]; rows: Array<Record<string, unknown>>; rowKey?: string; selectedRows?: string[]; emptyHint?: string }>();
const emit = defineEmits<{ commit: [rows: Array<Record<string, unknown>>]; rowSelect: [id: string, additive: boolean]; rowSelection: [ids: string[]]; addRow: [] }>();
const draft = ref<Array<Record<string, unknown>>>(cloneJson(props.rows));
const active = ref({ row: 0, col: 0 });
const anchor = ref({ row: 0, col: 0 });
const editing = ref(false);
const lastSelectedRow = ref<number | null>(null);
const widths = ref<Record<string, number>>({});
watch(() => props.rows, (rows) => { draft.value = cloneJson(rows) }, { deep: true });

const selected = computed(() => ({
  r1: Math.min(active.value.row, anchor.value.row), r2: Math.max(active.value.row, anchor.value.row),
  c1: Math.min(active.value.col, anchor.value.col), c2: Math.max(active.value.col, anchor.value.col),
}));
const gridColumns = computed(() => `64px ${props.columns.map((column) => `${widths.value[column.key] ?? column.width ?? 150}px`).join(" ")}`);
function isSelected(row: number, col: number) { const s = selected.value; return row >= s.r1 && row <= s.r2 && col >= s.c1 && col <= s.c2 }
function activate(row: number, col: number, extend = false) { active.value = { row, col }; if (!extend) anchor.value = { row, col } }
function selectColumn(col: number) { anchor.value = { row: 0, col }; active.value = { row: Math.max(0, draft.value.length - 1), col } }
function selectRow(row: number, event: MouseEvent) {
  anchor.value = { row, col: 0 }; active.value = { row, col: Math.max(0, props.columns.length - 1) };
  const id = String(draft.value[row]?.[props.rowKey ?? "id"] ?? "");
  if (!id) return;
  if (event.shiftKey && lastSelectedRow.value !== null) {
    const start = Math.min(lastSelectedRow.value, row); const end = Math.max(lastSelectedRow.value, row);
    const ids = draft.value.slice(start, end + 1).map((item) => String(item[props.rowKey ?? "id"] ?? "")).filter(Boolean);
    emit("rowSelection", ids);
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
function selectAll() { anchor.value = { row: 0, col: 0 }; active.value = { row: Math.max(0, draft.value.length - 1), col: Math.max(0, props.columns.length - 1) } }
function move(rowDelta: number, colDelta: number, extend = false) {
  activate(Math.max(0, Math.min(draft.value.length - 1, active.value.row + rowDelta)), Math.max(0, Math.min(props.columns.length - 1, active.value.col + colDelta)), extend);
}
async function copy(cut = false) {
  const s = selected.value;
  const rows = draft.value.slice(s.r1, s.r2 + 1).map((row) => props.columns.slice(s.c1, s.c2 + 1).map((column) => row[column.key]));
  await navigator.clipboard.writeText(toTsv(rows));
  if (cut) clearSelection();
}
function clearSelection() {
  const s = selected.value;
  for (let row = s.r1; row <= s.r2; row += 1) for (let col = s.c1; col <= s.c2; col += 1) if (!props.columns[col].readonly) draft.value[row][props.columns[col].key] = props.columns[col].defaultValue ?? "";
}
async function paste() {
  const cells = parseTsv(await navigator.clipboard.readText());
  while (draft.value.length < active.value.row + cells.length) draft.value.push(Object.fromEntries(props.columns.map((column) => [column.key, ""])));
  cells.forEach((row, rowOffset) => row.forEach((value, colOffset) => {
    const column = props.columns[active.value.col + colOffset];
    if (column && !column.readonly && (!column.options || column.options.some((option) => option.value === value))) draft.value[active.value.row + rowOffset][column.key] = value;
  }));
}
function onKey(event: KeyboardEvent) {
  if (editing.value) {
    if (event.key === "Escape") { editing.value = false; event.preventDefault() }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { void copy(); event.preventDefault(); return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "x") { void copy(true); event.preventDefault(); return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") { void paste(); event.preventDefault(); return }
  if (event.key === "Delete") { clearSelection(); event.preventDefault(); return }
  if (event.key === "F2") { editing.value = true; event.preventDefault(); return }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !props.columns[active.value.col]?.readonly) {
    const column = props.columns[active.value.col];
    if (!column.options) draft.value[active.value.row][column.key] = event.key;
    editing.value = true; event.preventDefault(); return;
  }
  const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, event.shiftKey ? -1 : 1], Enter: [event.shiftKey ? -1 : 1, 0] };
  if (moves[event.key]) { move(...moves[event.key], event.shiftKey && event.key.startsWith("Arrow")); event.preventDefault() }
}
function resize(column: GridColumn, event: PointerEvent) {
  const start = event.clientX; const initial = widths.value[column.key] ?? column.width ?? 150;
  const move = (next: PointerEvent) => { widths.value[column.key] = Math.max(72, initial + next.clientX - start) };
  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up) };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
}
function autoFit(column: GridColumn) {
  const longest = Math.max(column.label.length, ...draft.value.map((row) => String(row[column.key] ?? "").length));
  widths.value[column.key] = Math.min(360, Math.max(72, longest * 9 + 28));
}
function editCell(row: number, col: number) { activate(row, col); editing.value = true; void nextTick(() => (document.querySelector(".sheet-cell.editing input, .sheet-cell.editing select") as HTMLInputElement | HTMLSelectElement | null)?.focus()) }
function commit() { emit("commit", cloneJson(draft.value)) }
function addDraftRow() {
  draft.value.push(Object.fromEntries(props.columns.map((column) => [column.key, column.defaultValue ?? ""])));
  active.value = { row: draft.value.length - 1, col: 0 };
  anchor.value = { ...active.value };
  emit("addRow");
}
defineExpose({ addDraftRow });
</script>

<template>
  <div class="sheet" tabindex="0" @keydown="onKey">
    <div class="sheet-row sheet-header" :style="{ gridTemplateColumns: gridColumns }">
      <div class="sheet-head row-number" @click="selectAll">#</div>
      <div v-for="(column, colIndex) in columns" :key="column.key" class="sheet-head" @click="selectColumn(colIndex)" @dblclick="autoFit(column)">
        {{ column.label }}<span class="column-resizer" @pointerdown.stop="resize(column, $event)" />
      </div>
    </div>
    <div v-for="(row, rowIndex) in draft" :key="String(row[rowKey ?? 'id'] ?? rowIndex)" class="sheet-row" :class="{ 'row-selected': selectedRows?.includes(String(row[rowKey ?? 'id'])) }" :style="{ gridTemplateColumns: gridColumns }">
      <button type="button" class="sheet-row-number" @click="selectRow(rowIndex, $event)"><span class="row-check" :class="{ checked: selectedRows?.includes(String(row[rowKey ?? 'id'])) }" role="checkbox" :aria-checked="selectedRows?.includes(String(row[rowKey ?? 'id']))" @click.stop="toggleRow(rowIndex)">✓</span><span>{{ rowIndex + 1 }}</span></button>
      <div v-for="(column, colIndex) in columns" :key="column.key" class="sheet-cell" :class="{ selected: isSelected(rowIndex, colIndex), active: active.row === rowIndex && active.col === colIndex, editing: editing && active.row === rowIndex && active.col === colIndex }" @mousedown="activate(rowIndex, colIndex, $event.shiftKey)" @dblclick="editCell(rowIndex, colIndex)">
        <select v-if="column.options && !column.readonly" v-model="row[column.key] as string" class="sheet-inline-select" @mousedown.stop @click.stop @change="editing = false"><option v-for="option in column.options" :key="option.value" :value="option.value">{{ option.label }}</option></select>
        <input v-else-if="editing && active.row === rowIndex && active.col === colIndex && !column.readonly" v-model="row[column.key] as string" @blur="editing = false" @keydown.enter.stop.prevent="editing = false; move(1, 0)" />
        <span v-else>{{ row[column.key] }}</span>
      </div>
    </div>
    <div v-if="!draft.length" class="sheet-empty">{{ emptyHint || '행이 없습니다.' }}</div>
  </div>
  <div class="sheet-actions">
    <button type="button" @click="addDraftRow">행 추가</button>
    <button type="button" class="primary" @click="commit">변경사항 저장</button>
  </div>
</template>
