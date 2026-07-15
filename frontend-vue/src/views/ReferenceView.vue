<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api/client";

type Row = Record<string, unknown> & { id?: string };
const resources = {
  "key-layout-types": { label: "Key Layout Type", columns: ["name", "scribe_lane_rows", "sort_order"] },
  "key-drawing-types": { label: "Key Drawing Type", columns: ["symbol", "trench_mesa", "key_shape", "ri_notation", "drawing_guide", "gds_path", "sort_order"] },
  "key-shapes": { label: "Key Shape", columns: ["key_shape", "drawing_guide", "sort_order"] },
  "relation-styles": { label: "Arrow Style", columns: ["name", "stroke_color", "line_pattern", "stroke_width", "marker_type", "sort_order"] },
  "box-presets": { label: "Box Preset", columns: ["name", "fill_color", "stroke_color", "text_color", "font_size", "width", "height", "stroke_width", "is_default", "sort_order"] },
} as const;
type Resource = keyof typeof resources;
const active = ref<Resource>("key-layout-types");
const rows = ref<Record<Resource, Row[]>>({ "key-layout-types": [], "key-drawing-types": [], "key-shapes": [], "relation-styles": [], "box-presets": [] });
const status = ref("");
async function load() {
  const [layouts, drawings, shapes, styles, presets] = await Promise.all([api.keyLayoutTypes(), api.keyDrawingTypes(), api.keyShapes(), api.relationStyles(), api.boxPresets()]);
  rows.value = { "key-layout-types": layouts as unknown as Row[], "key-drawing-types": drawings as unknown as Row[], "key-shapes": shapes as unknown as Row[], "relation-styles": styles as unknown as Row[], "box-presets": presets as unknown as Row[] };
}
function add() { rows.value[active.value].push(Object.fromEntries(resources[active.value].columns.map((column) => [column, column === "sort_order" ? rows.value[active.value].length : column === "is_default" ? false : ""]))) }
async function save(row: Row) {
  const data = { ...row }; delete data.id;
  if (row.id) await api.updateReference(active.value, row.id, data); else await api.createReference(active.value, data);
  status.value = "저장 완료"; await load();
}
async function remove(row: Row) { if (!row.id || !confirm("기준정보를 삭제할까요?")) return; await api.deleteReference(active.value, row.id); await load() }
onMounted(load);
</script>
<template><section class="page"><div class="page-title"><div><p class="eyebrow">GLOBAL REFERENCE DATA</p><h1>기준정보</h1><p>모든 프로젝트가 함께 사용하는 공정 기준과 시각 스타일입니다.</p></div><span class="status-pill">{{ status || '전역 데이터' }}</span></div><nav class="subtabs"><button v-for="(config, key) in resources" :key="key" :class="{ active: active === key }" @click="active = key as Resource">{{ config.label }}</button></nav><div class="panel data-panel"><div class="panel-heading"><h2>{{ resources[active].label }}</h2><button class="primary" @click="add">행 추가</button></div><div class="reference-table"><div class="reference-row reference-head" :style="{ gridTemplateColumns: `repeat(${resources[active].columns.length}, minmax(110px, 1fr)) 120px` }"><span v-for="column in resources[active].columns" :key="column">{{ column }}</span><span>작업</span></div><div v-for="(row, index) in rows[active]" :key="row.id || index" class="reference-row" :style="{ gridTemplateColumns: `repeat(${resources[active].columns.length}, minmax(110px, 1fr)) 120px` }"><template v-for="column in resources[active].columns" :key="column"><input v-if="column.includes('color')" v-model="row[column] as string" type="color"><input v-else-if="column === 'is_default'" v-model="row[column] as boolean" type="checkbox"><input v-else v-model="row[column] as string"></template><div class="row"><button @click="save(row)">저장</button><button class="danger" :disabled="!row.id" @click="remove(row)">삭제</button></div></div></div></div></section></template>
