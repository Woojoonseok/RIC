<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import { cloneJson } from "../domain/clone";
import { useReferenceStore } from "../stores/reference";
import type { ReferenceResource } from "../types";

type Row = Record<string, unknown> & { id?: string };
type FieldType = "text" | "number" | "boolean" | "color" | "select";
interface Field { key: string; label: string; type?: FieldType; options?: string[]; width?: number }
interface ResourceConfig { label: string; description: string; fields: Field[] }

const resources: Record<ReferenceResource, ResourceConfig> = {
  "key-layout-types": {
    label: "Key Layout Type", description: "Scribe lane 행 수와 표시 순서를 관리합니다.",
    fields: [{ key: "name", label: "이름", width: 220 }, { key: "scribe_lane_rows", label: "Scribe lane 행", type: "number" }, { key: "sort_order", label: "순서", type: "number" }],
  },
  "key-drawing-types": {
    label: "Key Drawing Type", description: "도면 기호와 GDS 기준을 관리합니다.",
    fields: [
      { key: "symbol", label: "기호" }, { key: "trench_mesa", label: "Trench / Mesa" },
      { key: "key_shape", label: "Key Shape" }, { key: "ri_notation", label: "RI 표기" },
      { key: "drawing_guide", label: "Drawing Guide", width: 240 }, { key: "gds_path", label: "GDS 경로", width: 240 },
      { key: "sort_order", label: "순서", type: "number" },
    ],
  },
  "key-shapes": {
    label: "Key Shape", description: "Key 형상과 도면 작성 가이드를 관리합니다.",
    fields: [{ key: "key_shape", label: "Key Shape", width: 220 }, { key: "drawing_guide", label: "Drawing Guide", width: 320 }, { key: "sort_order", label: "순서", type: "number" }],
  },
  "relation-styles": {
    label: "Arrow Style", description: "Editor 관계선의 색상, 굵기, 패턴을 관리합니다.",
    fields: [
      { key: "name", label: "이름", width: 220 }, { key: "stroke_color", label: "선 색상", type: "color" },
      { key: "line_pattern", label: "선 패턴", type: "select", options: ["solid", "dashed", "dotted", "reference"] },
      { key: "stroke_width", label: "선 굵기", type: "number" }, { key: "marker_type", label: "끝 모양", type: "select", options: ["arrow", "none"] },
      { key: "sort_order", label: "순서", type: "number" },
    ],
  },
  "box-presets": {
    label: "Box Preset", description: "Layer Box의 기본 크기와 색상을 관리합니다.",
    fields: [
      { key: "name", label: "이름", width: 220 }, { key: "fill_color", label: "채우기", type: "color" },
      { key: "stroke_color", label: "테두리", type: "color" }, { key: "text_color", label: "글자", type: "color" },
      { key: "font_size", label: "글자 크기", type: "number" }, { key: "width", label: "너비", type: "number" },
      { key: "height", label: "높이", type: "number" }, { key: "stroke_width", label: "테두리 굵기", type: "number" },
      { key: "is_default", label: "기본값", type: "boolean" }, { key: "sort_order", label: "순서", type: "number" },
    ],
  },
};

const reference = useReferenceStore();
const active = ref<ReferenceResource>("key-layout-types");
const drafts = ref<Record<ReferenceResource, Row[]>>({
  "key-layout-types": [], "key-drawing-types": [], "key-shapes": [], "relation-styles": [], "box-presets": [],
});
const query = ref("");
const status = ref("준비");
const busy = ref(false);
const activeConfig = computed(() => resources[active.value]);
const visibleRows = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return drafts.value[active.value];
  return drafts.value[active.value].filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(needle)));
});
const gridColumns = computed(() => `${activeConfig.value.fields.map((field) => `minmax(${field.width ?? 130}px, 1fr)`).join(" ")} 116px`);

function syncDrafts() {
  drafts.value = {
    "key-layout-types": cloneJson(reference.keyLayoutTypes) as unknown as Row[],
    "key-drawing-types": cloneJson(reference.keyDrawingTypes) as unknown as Row[],
    "key-shapes": cloneJson(reference.keyShapes) as unknown as Row[],
    "relation-styles": cloneJson(reference.relationStyles) as unknown as Row[],
    "box-presets": cloneJson(reference.boxPresets) as unknown as Row[],
  };
}
async function load() {
  busy.value = true;
  try { await reference.loadAll(); syncDrafts(); status.value = "최신 데이터" }
  catch (error) { status.value = error instanceof Error ? error.message : String(error) }
  finally { busy.value = false }
}
function nextUniqueName(prefix: string) {
  const names = new Set(drafts.value[active.value].map((row) => String(row.name ?? row.key_shape ?? "").trim().toLowerCase()));
  let index = 1; let name = prefix;
  while (names.has(name.toLowerCase())) { index += 1; name = `${prefix} ${index}` }
  return name;
}
function add() {
  const row = Object.fromEntries(activeConfig.value.fields.map((field) => [field.key, field.type === "boolean" ? false : field.type === "number" ? 0 : ""]));
  row.sort_order = drafts.value[active.value].length;
  if (["key-layout-types", "relation-styles", "box-presets"].includes(active.value)) row.name = nextUniqueName("New");
  if (active.value === "key-shapes") row.key_shape = nextUniqueName("Shape");
  if (active.value === "relation-styles") Object.assign(row, { stroke_color: "#334155", stroke_width: 2, line_pattern: "solid", marker_type: "arrow" });
  if (active.value === "box-presets") Object.assign(row, { fill_color: "#dbeafe", stroke_color: "#2563eb", text_color: "#111827", font_size: 16, width: 180, height: 72, stroke_width: 2 });
  drafts.value[active.value].unshift(row);
  query.value = "";
  status.value = "새 행을 작성한 뒤 저장하세요.";
}
function normalize(row: Row) {
  const data = { ...row }; delete data.id;
  for (const field of activeConfig.value.fields) {
    if (field.type === "number") data[field.key] = data[field.key] === "" || data[field.key] == null ? null : Number(data[field.key]);
  }
  return data;
}
async function save(row: Row) {
  busy.value = true;
  try {
    const data = normalize(row);
    const saved = row.id
      ? await api.updateReference(active.value, row.id, data as never)
      : await api.createReference(active.value, data as never);
    Object.assign(row, cloneJson(saved));
    await reference.loadAll();
    status.value = `${activeConfig.value.label} 저장 완료`;
  } catch (error) { status.value = error instanceof Error ? error.message : String(error) }
  finally { busy.value = false }
}
async function remove(row: Row) {
  if (!row.id) { drafts.value[active.value] = drafts.value[active.value].filter((item) => item !== row); return }
  if (!confirm("이 기준정보를 삭제할까요?")) return;
  busy.value = true;
  try {
    await api.deleteReference(active.value, row.id);
    drafts.value[active.value] = drafts.value[active.value].filter((item) => item !== row);
    await reference.loadAll();
    status.value = "삭제 완료";
  } catch (error) { status.value = error instanceof Error ? error.message : String(error) }
  finally { busy.value = false }
}
onMounted(load);
</script>

<template>
  <section class="page wide-page reference-page">
    <div class="page-title">
      <div><p class="eyebrow">GLOBAL REFERENCE DATA</p><h1>기준정보</h1><p>모든 프로젝트가 함께 사용하는 공정 기준과 Editor 스타일입니다.</p></div>
      <span class="status-pill" :class="{ busy }">{{ busy ? '처리 중…' : status }}</span>
    </div>
    <nav class="resource-tabs" aria-label="기준정보 종류">
      <button v-for="(config, key) in resources" :key="key" :class="{ active: active === key }" @click="active = key; query = ''">
        <span>{{ config.label }}</span><b>{{ drafts[key].length }}</b>
      </button>
    </nav>
    <div class="panel data-panel reference-workbench">
      <div class="panel-heading reference-heading">
        <div><h2>{{ activeConfig.label }}</h2><small>{{ activeConfig.description }}</small></div>
        <div class="button-strip"><input v-model="query" class="reference-search" placeholder="현재 표 검색"><button :disabled="busy" @click="load">다시 불러오기</button><button class="primary" :disabled="busy" @click="add">새 행</button></div>
      </div>
      <div class="reference-table">
        <div class="reference-row reference-head" :style="{ gridTemplateColumns: gridColumns }"><span v-for="field in activeConfig.fields" :key="field.key">{{ field.label }}</span><span>작업</span></div>
        <div v-for="(row, index) in visibleRows" :key="row.id || `new-${index}`" class="reference-row" :class="{ 'new-reference-row': !row.id }" :style="{ gridTemplateColumns: gridColumns }">
          <template v-for="field in activeConfig.fields" :key="field.key">
            <label v-if="field.type === 'color'" class="compact-color"><input v-model="row[field.key] as string" type="color"><input v-model="row[field.key] as string" type="text"></label>
            <label v-else-if="field.type === 'boolean'" class="boolean-cell"><input v-model="row[field.key] as boolean" type="checkbox"><span>{{ row[field.key] ? '사용' : '미사용' }}</span></label>
            <select v-else-if="field.type === 'select'" v-model="row[field.key] as string"><option v-for="option in field.options" :key="option" :value="option">{{ option }}</option></select>
            <input v-else v-model="row[field.key] as string | number" :type="field.type === 'number' ? 'number' : 'text'">
          </template>
          <div class="row-actions"><button class="primary subtle" :disabled="busy" @click="save(row)">저장</button><button class="danger ghost" :disabled="busy" @click="remove(row)">{{ row.id ? '삭제' : '취소' }}</button></div>
        </div>
        <div v-if="!visibleRows.length" class="reference-empty">{{ query ? '검색 결과가 없습니다.' : '등록된 기준정보가 없습니다. 새 행을 추가해 주세요.' }}</div>
      </div>
    </div>
  </section>
</template>
