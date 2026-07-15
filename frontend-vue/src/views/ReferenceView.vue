<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import { useReferenceStore } from "../stores/reference";
import type { ReferenceResource } from "../types";

type Row = Record<string, unknown> & { id?: string };
const resources = {
  "key-layout-types": { label: "Key Layout Type", columns: ["name", "scribe_lane_rows", "sort_order"] },
  "key-drawing-types": { label: "Key Drawing Type", columns: ["symbol", "trench_mesa", "key_shape", "ri_notation", "drawing_guide", "gds_path", "sort_order"] },
  "key-shapes": { label: "Key Shape", columns: ["key_shape", "drawing_guide", "sort_order"] },
  "relation-styles": { label: "Arrow Style", columns: ["name", "stroke_color", "line_pattern", "stroke_width", "marker_type", "sort_order"] },
  "box-presets": { label: "Box Preset", columns: ["name", "fill_color", "stroke_color", "text_color", "font_size", "width", "height", "stroke_width", "is_default", "sort_order"] },
} as const;
type Resource = keyof typeof resources;
const reference = useReferenceStore();
const active = ref<Resource>("key-layout-types");
const rows = computed<Record<Resource, Row[]>>(() => ({
  "key-layout-types": reference.keyLayoutTypes as unknown as Row[],
  "key-drawing-types": reference.keyDrawingTypes as unknown as Row[],
  "key-shapes": reference.keyShapes as unknown as Row[],
  "relation-styles": reference.relationStyles as unknown as Row[],
  "box-presets": reference.boxPresets as unknown as Row[],
}));
const status = ref("");
async function load() { await reference.loadAll() }
const BOX_SWATCHES = ["#2563eb", "#d97706", "#dc2626", "#16a34a", "#7c3aed", "#0891b2", "#6b7280", "#111827"];
function nextUniqueName(prefix: string) {
  const names = new Set(rows.value[active.value].map((row) => String(row.name ?? row.key_shape ?? "").trim().toLowerCase()));
  let index = 1; let name = prefix;
  while (names.has(name.toLowerCase())) { index += 1; name = `${prefix} ${index}` }
  return name;
}
function add() {
  const row = Object.fromEntries(resources[active.value].columns.map((column) => [column, column === "sort_order" ? rows.value[active.value].length : column === "is_default" ? false : ""]));
  if (active.value === "key-layout-types" || active.value === "relation-styles" || active.value === "box-presets") row.name = nextUniqueName("New");
  if (active.value === "key-shapes") row.key_shape = nextUniqueName("Shape");
  if (active.value === "relation-styles") Object.assign(row, { stroke_color: "#334155", stroke_width: 2, line_pattern: "solid", marker_type: "arrow" });
  if (active.value === "box-presets") Object.assign(row, { fill_color: "#dbeafe", stroke_color: "#2563eb", text_color: "#111827", font_size: 16, width: 180, height: 72, stroke_width: 2 });
  rows.value[active.value].push(row);
}
function normalize(row: Row) {
  const data = { ...row }; delete data.id;
  for (const key of ["sort_order", "scribe_lane_rows", "stroke_width", "font_size", "width", "height"]) {
    if (key in data && data[key] !== "" && data[key] != null) data[key] = Number(data[key]);
  }
  return data;
}
async function save(row: Row) {
  const data = normalize(row);
  if (row.id) await api.updateReference(active.value as ReferenceResource, row.id, data as never); else await api.createReference(active.value as ReferenceResource, data as never);
  status.value = "저장 완료"; await load();
}
async function remove(row: Row) { if (!row.id || !confirm("기준정보를 삭제할까요?")) return; await api.deleteReference(active.value, row.id); await load() }
onMounted(load);
</script>
<template><section class="page wide-page"><div class="page-title"><div><p class="eyebrow">GLOBAL REFERENCE DATA</p><h1>기준정보</h1><p>모든 프로젝트가 함께 사용하는 공정 기준과 시각 스타일입니다.</p></div><span class="status-pill">{{ status || '전역 데이터' }}</span></div><nav class="subtabs"><button v-for="(config, key) in resources" :key="key" :class="{ active: active === key }" @click="active = key as Resource">{{ config.label }}</button></nav><div class="panel data-panel"><div class="panel-heading"><div><h2>{{ resources[active].label }}</h2><small>{{ rows[active].length }} rows</small></div><button class="primary" @click="add">행 추가</button></div><div class="reference-table"><div class="reference-row reference-head" :style="{ gridTemplateColumns: `repeat(${resources[active].columns.length}, minmax(110px, 1fr)) 140px` }"><span v-for="column in resources[active].columns" :key="column">{{ column }}</span><span>작업</span></div><div v-for="(row, index) in rows[active]" :key="row.id || index" class="reference-row" :style="{ gridTemplateColumns: `repeat(${resources[active].columns.length}, minmax(110px, 1fr)) 140px` }"><template v-for="column in resources[active].columns" :key="column"><div v-if="column.includes('color')" class="color-cell"><input v-model="row[column] as string" type="color"><div class="color-swatches"><button v-for="color in BOX_SWATCHES" :key="color" class="color-swatch" :style="{ background: color }" :title="color" @click="row[column] = color"/></div></div><input v-else-if="column === 'is_default'" v-model="row[column] as boolean" type="checkbox"><select v-else-if="column === 'line_pattern'" v-model="row[column] as string"><option v-for="value in ['solid','dashed','dotted','reference']" :key="value">{{ value }}</option></select><select v-else-if="column === 'marker_type'" v-model="row[column] as string"><option value="arrow">arrow</option><option value="none">none</option></select><input v-else v-model="row[column] as string"></template><div class="stack-actions"><button @click="save(row)">저장</button><button class="danger" :disabled="!row.id" @click="remove(row)">삭제</button></div></div></div></div></section></template>
