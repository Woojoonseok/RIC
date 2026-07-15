<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { cloneJson } from "../../domain/clone";
import { parseTsv, toTsv } from "../../domain/tsv";

export interface GridColumn { key: string; label: string; width?: number; readonly?: boolean }
const props = defineProps<{ columns: GridColumn[]; rows: Array<Record<string, unknown>>; rowKey?: string; selectedRows?: string[]; emptyHint?: string }>();
const emit = defineEmits<{ commit: [rows: Array<Record<string, unknown>>]; rowSelect: [id: string, additive: boolean]; addRow: [] }>();
const draft = ref<Array<Record<string, unknown>>>(cloneJson(props.rows));
const active = ref({ row: 0, col: 0 });
const anchor = ref({ row: 0, col: 0 });
const editing = ref(false);
const widths = ref<Record<string, number>>({});
watch(() => props.rows, (rows) => { draft.value = cloneJson(rows) }, { deep: true });

const selected = computed(() => ({
  r1: Math.min(active.value.row, anchor.value.row), r2: Math.max(active.value.row, anchor.value.row),
  c1: Math.min(active.value.col, anchor.value.col), c2: Math.max(active.value.col, anchor.value.col),
}));
const gridColumns = computed(() => `42px ${props.columns.map((column) => `${widths.value[column.key] ?? column.width ?? 150}px`).join(" ")}`);
function isSelected(row: number, col: number) { const s = selected.value; return row >= s.r1 && row <= s.r2 && col >= s.c1 && col <= s.c2 }
function activate(row: number, col: number, extend = false) { active.value = { row, col }; if (!extend) anchor.value = { row, col } }
function selectColumn(col: number) { anchor.value = { row: 0, col }; active.value = { row: Math.max(0, draft.value.length - 1), col } }
function selectRow(row: number, event: MouseEvent) {
  anchor.value = { row, col: 0 }; active.value = { row, col: Math.max(0, props.columns.length - 1) };
  const id = String(draft.value[row]?.[props.rowKey ?? "id"] ?? "");
  if (id) emit("rowSelect", id, event.ctrlKey || event.metaKey || event.shiftKey);
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
  for (let row = s.r1; row <= s.r2; row += 1) for (let col = s.c1; col <= s.c2; col += 1) if (!props.columns[col].readonly) draft.value[row][props.columns[col].key] = "";
}
async function paste() {
  const cells = parseTsv(await navigator.clipboard.readText());
  while (draft.value.length < active.value.row + cells.length) draft.value.push(Object.fromEntries(props.columns.map((column) => [column.key, ""])));
  cells.forEach((row, rowOffset) => row.forEach((value, colOffset) => {
    const column = props.columns[active.value.col + colOffset];
    if (column && !column.readonly) draft.value[active.value.row + rowOffset][column.key] = value;
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
    draft.value[active.value.row][props.columns[active.value.col].key] = event.key;
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
function editCell(row: number, col: number) { activate(row, col); editing.value = true; void nextTick(() => (document.querySelector(".sheet-cell.editing input") as HTMLInputElement | null)?.focus()) }
function commit() { emit("commit", cloneJson(draft.value)) }
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
      <button type="button" class="sheet-row-number" @click="selectRow(rowIndex, $event)">{{ rowIndex + 1 }}</button>
      <div v-for="(column, colIndex) in columns" :key="column.key" class="sheet-cell" :class="{ selected: isSelected(rowIndex, colIndex), active: active.row === rowIndex && active.col === colIndex, editing: editing && active.row === rowIndex && active.col === colIndex }" @mousedown="activate(rowIndex, colIndex, $event.shiftKey)" @dblclick="editCell(rowIndex, colIndex)">
        <input v-if="editing && active.row === rowIndex && active.col === colIndex && !column.readonly" v-model="row[column.key] as string" @blur="editing = false" @keydown.enter.stop.prevent="editing = false; move(1, 0)" />
        <span v-else>{{ row[column.key] }}</span>
      </div>
    </div>
    <div v-if="!draft.length" class="sheet-empty">{{ emptyHint || '행이 없습니다.' }}</div>
  </div>
  <div class="sheet-actions">
    <button type="button" @click="draft.push(Object.fromEntries(columns.map((column) => [column.key, '']))); emit('addRow')">행 추가</button>
    <button type="button" class="primary" @click="commit">변경사항 저장</button>
  </div>
</template>
