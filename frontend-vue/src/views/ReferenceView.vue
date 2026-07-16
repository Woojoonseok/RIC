<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import { cloneJson } from "../domain/clone";
import { useReferenceStore } from "../stores/reference";
import type { ReferenceResource } from "../types";

type Row = Record<string, unknown> & { id?: string };
type FieldType = "text" | "number" | "boolean" | "color" | "select" | "line-pattern" | "line-width" | "marker" | "box-preview";
interface Field { key: string; label: string; type?: FieldType; options?: string[]; width?: number }
interface ResourceConfig { label: string; description: string; fields: Field[] }

const resources: Record<ReferenceResource, ResourceConfig> = {
  "key-layout-types": {
    label: "Key Layout Type", description: "Scribe lane 구성에 사용하는 배치 유형을 관리합니다.",
    fields: [{ key: "name", label: "이름", width: 220 }, { key: "scribe_lane_rows", label: "Scribe lane 행", type: "number" }],
  },
  "key-drawing-types": {
    label: "Key Drawing Type", description: "도면 기호와 GDS 기준을 관리합니다.",
    fields: [
      { key: "symbol", label: "기호" }, { key: "trench_mesa", label: "Trench / Mesa" },
      { key: "key_shape", label: "Key Shape" }, { key: "ri_notation", label: "RI 표기" },
      { key: "drawing_guide", label: "Drawing Guide", width: 240 }, { key: "gds_path", label: "GDS 경로", width: 240 },
    ],
  },
  "key-shapes": {
    label: "Key Shape", description: "Key 형상과 도면 작성 가이드를 관리합니다.",
    fields: [{ key: "key_shape", label: "Key Shape", width: 220 }, { key: "drawing_guide", label: "Drawing Guide", width: 320 }],
  },
  "relation-styles": {
    label: "Arrow Style", description: "Editor 관계선의 색상, 굵기, 패턴을 관리합니다.",
    fields: [
      { key: "name", label: "이름", width: 190 }, { key: "stroke_color", label: "선 색상", type: "color", width: 150 },
      { key: "line_pattern", label: "선 패턴", type: "line-pattern", width: 190 },
      { key: "stroke_width", label: "선 굵기", type: "line-width", width: 150 }, { key: "marker_type", label: "끝 모양", type: "marker", width: 170 },
    ],
  },
  "box-presets": {
    label: "Box Preset", description: "Layer Box의 기본 크기와 색상을 관리합니다.",
    fields: [
      { key: "preview", label: "미리보기", type: "box-preview", width: 190 }, { key: "name", label: "이름", width: 180 }, { key: "fill_color", label: "채우기", type: "color", width: 150 },
      { key: "stroke_color", label: "테두리", type: "color" }, { key: "text_color", label: "글자", type: "color" },
      { key: "font_size", label: "글자 크기", type: "number" }, { key: "width", label: "너비", type: "number" },
      { key: "height", label: "높이", type: "number" }, { key: "stroke_width", label: "테두리 굵기", type: "line-width", width: 150 },
      { key: "is_default", label: "기본값", type: "boolean" },
    ],
  },
};

const themeColors = [
  "#ffffff", "#f2f4f7", "#d0d5dd", "#667085", "#101828",
  "#dbeafe", "#2e90fa", "#175cd3", "#3538cd", "#7f56d9",
  "#fce7f6", "#ee46bc", "#fef3f2", "#f04438", "#b42318",
  "#fffaeb", "#f79009", "#dc6803", "#ecfdf3", "#12b76a",
  "#067647", "#ecfdff", "#06aed4", "#344054", "#000000",
];
const linePatterns = [
  { value: "solid", label: "실선", dash: "" },
  { value: "dashed", label: "대시", dash: "8 6" },
  { value: "dotted", label: "점선", dash: "2 6" },
  { value: "reference", label: "참조선", dash: "10 4 2 4" },
];
const lineWidths = [1, 2, 3, 4, 6, 8];

const reference = useReferenceStore();
const active = ref<ReferenceResource>("key-layout-types");
const drafts = ref<Record<ReferenceResource, Row[]>>({
  "key-layout-types": [], "key-drawing-types": [], "key-shapes": [], "relation-styles": [], "box-presets": [],
});
const query = ref("");
const status = ref("준비");
const busy = ref(false);
const savingRows = new Set<Row>();
const queuedRows = new Set<Row>();
const saveTimers = new Map<Row, ReturnType<typeof setTimeout>>();
const activeConfig = computed(() => resources[active.value]);
const visibleRows = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return drafts.value[active.value];
  return drafts.value[active.value].filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(needle)));
});
const gridColumns = computed(() => `${activeConfig.value.fields.map((field) => `minmax(${field.width ?? 130}px, 1fr)`).join(" ")} 68px`);

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
async function add() {
  const resource = active.value;
  const row = Object.fromEntries(activeConfig.value.fields.filter((field) => field.type !== "box-preview").map((field) => [field.key, field.type === "boolean" ? false : field.type === "number" ? 0 : ""]));
  row.sort_order = drafts.value[resource].length;
  if (["key-layout-types", "relation-styles", "box-presets"].includes(resource)) row.name = nextUniqueName("New");
  if (resource === "key-shapes") row.key_shape = nextUniqueName("Shape");
  if (resource === "relation-styles") Object.assign(row, { stroke_color: "#334155", stroke_width: 2, line_pattern: "solid", marker_type: "arrow" });
  if (resource === "box-presets") Object.assign(row, { fill_color: "#dbeafe", stroke_color: "#2563eb", text_color: "#111827", font_size: 16, width: 180, height: 72, stroke_width: 2 });
  query.value = "";
  busy.value = true;
  status.value = "새 항목 추가 중…";
  try {
    const saved = await api.createReference(resource, normalize(row, resource) as never);
    drafts.value[resource].unshift(cloneJson(saved) as unknown as Row);
    await reference.loadAll();
    status.value = "새 항목이 추가되었습니다";
  } catch (error) { status.value = error instanceof Error ? error.message : String(error) }
  finally { busy.value = false }
}
function normalize(row: Row, resource: ReferenceResource) {
  const data = { ...row }; delete data.id;
  delete data.preview;
  for (const field of resources[resource].fields) {
    if (field.type === "number") data[field.key] = data[field.key] === "" || data[field.key] == null ? null : Number(data[field.key]);
  }
  return data;
}
async function save(row: Row, resource: ReferenceResource) {
  if (!row.id) return;
  if (savingRows.has(row)) { queuedRows.add(row); return }
  savingRows.add(row);
  status.value = "변경사항 저장 중…";
  try {
    const data = normalize(row, resource);
    const saved = await api.updateReference(resource, row.id, data as never);
    Object.assign(row, cloneJson(saved));
    await reference.loadAll();
    status.value = "모든 변경사항 저장됨";
  } catch (error) { status.value = error instanceof Error ? error.message : String(error) }
  finally {
    savingRows.delete(row);
    if (queuedRows.delete(row)) void save(row, resource);
  }
}
function scheduleSave(row: Row) {
  const resource = active.value;
  const timer = saveTimers.get(row);
  if (timer) clearTimeout(timer);
  status.value = "입력 중…";
  saveTimers.set(row, setTimeout(() => { saveTimers.delete(row); void save(row, resource) }, 500));
}
function saveNow(row: Row) {
  const resource = active.value;
  const timer = saveTimers.get(row);
  if (timer) clearTimeout(timer);
  saveTimers.delete(row);
  void save(row, resource);
}
function choose(row: Row, key: string, value: string | number | boolean, event?: Event) {
  row[key] = value;
  (event?.currentTarget as HTMLElement | null)?.closest("details")?.removeAttribute("open");
  saveNow(row);
}
function colorLabel(value: unknown) { return String(value || "#000000").toUpperCase() }
function dashFor(value: unknown) { return linePatterns.find((option) => option.value === value)?.dash || "" }
async function remove(row: Row) {
  if (!row.id) return;
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
      <span class="status-pill" :class="{ busy: busy || savingRows.size }"><i></i>{{ busy ? '처리 중…' : status }}</span>
    </div>
    <nav class="resource-tabs" aria-label="기준정보 종류">
      <button v-for="(config, key) in resources" :key="key" :class="{ active: active === key }" @click="active = key; query = ''">
        <span>{{ config.label }}</span><b>{{ drafts[key].length }}</b>
      </button>
    </nav>
    <div class="panel data-panel reference-workbench">
      <div class="panel-heading reference-heading">
        <div><h2>{{ activeConfig.label }}</h2><small>{{ activeConfig.description }} · 변경사항은 자동으로 저장됩니다.</small></div>
        <div class="button-strip"><input v-model="query" class="reference-search" placeholder="항목 검색…"><button class="secondary-icon" :disabled="busy" title="다시 불러오기" @click="load">↻</button><button class="primary" :disabled="busy" @click="add">＋ 새 항목</button></div>
      </div>
      <div class="reference-table">
        <div class="reference-row reference-head" :style="{ gridTemplateColumns: gridColumns }"><span v-for="field in activeConfig.fields" :key="field.key">{{ field.label }}</span><span>작업</span></div>
        <div v-for="(row, index) in visibleRows" :key="row.id || `new-${index}`" class="reference-row" :class="{ 'new-reference-row': !row.id }" :style="{ gridTemplateColumns: gridColumns }">
          <template v-for="field in activeConfig.fields" :key="field.key">
            <div v-if="field.type === 'box-preview'" class="box-preset-preview" :style="{ background: String(row.fill_color), borderColor: String(row.stroke_color), borderWidth: `${row.stroke_width}px`, color: String(row.text_color), fontSize: `${Math.min(Number(row.font_size), 18)}px`, aspectRatio: `${row.width} / ${row.height}` }"><span>{{ row.name || 'Layer Box' }}</span></div>
            <details v-else-if="field.type === 'color'" class="visual-picker color-picker">
              <summary><i :style="{ background: String(row[field.key]) }"></i><span>{{ colorLabel(row[field.key]) }}</span><b>⌄</b></summary>
              <div class="picker-popover color-popover"><p>테마 색상</p><div class="swatch-grid"><button v-for="color in themeColors" :key="color" :class="{ selected: row[field.key] === color }" :style="{ background: color }" :title="color" @click.prevent="choose(row, field.key, color, $event)"></button></div><label>직접 입력<input v-model="row[field.key] as string" type="color" @change="saveNow(row)"><input v-model="row[field.key] as string" type="text" @input="scheduleSave(row)" @blur="saveNow(row)"></label></div>
            </details>
            <details v-else-if="field.type === 'line-pattern'" class="visual-picker line-picker">
              <summary><svg viewBox="0 0 120 24"><line x1="6" y1="12" x2="114" y2="12" :stroke="String(row.stroke_color)" stroke-width="3" :stroke-dasharray="dashFor(row[field.key])" stroke-linecap="round"/></svg><b>⌄</b></summary>
              <div class="picker-popover option-popover"><button v-for="option in linePatterns" :key="option.value" :class="{ selected: row[field.key] === option.value }" @click.prevent="choose(row, field.key, option.value, $event)"><svg viewBox="0 0 130 24"><line x1="5" y1="12" x2="125" y2="12" :stroke="String(row.stroke_color)" stroke-width="3" :stroke-dasharray="option.dash" stroke-linecap="round"/></svg><span>{{ option.label }}</span></button></div>
            </details>
            <details v-else-if="field.type === 'line-width'" class="visual-picker line-picker">
              <summary><svg viewBox="0 0 120 24"><line x1="6" y1="12" x2="114" y2="12" :stroke="String(row.stroke_color || '#344054')" :stroke-width="Number(row[field.key])" stroke-linecap="round"/></svg><span>{{ row[field.key] }} pt</span><b>⌄</b></summary>
              <div class="picker-popover option-popover width-options"><button v-for="width in lineWidths" :key="width" :class="{ selected: Number(row[field.key]) === width }" @click.prevent="choose(row, field.key, width, $event)"><svg viewBox="0 0 130 24"><line x1="5" y1="12" x2="125" y2="12" :stroke="String(row.stroke_color || '#344054')" :stroke-width="width" stroke-linecap="round"/></svg><span>{{ width }} pt</span></button></div>
            </details>
            <details v-else-if="field.type === 'marker'" class="visual-picker line-picker">
              <summary><svg viewBox="0 0 120 24"><defs><marker :id="`summary-arrow-${index}`" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" :fill="String(row.stroke_color)"/></marker></defs><line x1="6" y1="12" x2="108" y2="12" :stroke="String(row.stroke_color)" stroke-width="3" :marker-end="row[field.key] === 'arrow' ? `url(#summary-arrow-${index})` : undefined"/></svg><b>⌄</b></summary>
              <div class="picker-popover option-popover marker-options"><button :class="{ selected: row[field.key] === 'none' }" @click.prevent="choose(row, field.key, 'none', $event)"><svg viewBox="0 0 130 24"><line x1="5" y1="12" x2="125" y2="12" :stroke="String(row.stroke_color)" stroke-width="3"/></svg><span>끝 모양 없음</span></button><button :class="{ selected: row[field.key] === 'arrow' }" @click.prevent="choose(row, field.key, 'arrow', $event)"><svg viewBox="0 0 130 24"><path d="M5 12 H118 M110 5 L120 12 L110 19" fill="none" :stroke="String(row.stroke_color)" stroke-width="3" stroke-linejoin="round"/></svg><span>화살표</span></button></div>
            </details>
            <label v-else-if="field.type === 'boolean'" class="boolean-cell"><input v-model="row[field.key] as boolean" type="checkbox" @change="saveNow(row)"><span>{{ row[field.key] ? '사용' : '미사용' }}</span></label>
            <select v-else-if="field.type === 'select'" v-model="row[field.key] as string" @change="saveNow(row)"><option v-for="option in field.options" :key="option" :value="option">{{ option }}</option></select>
            <input v-else v-model="row[field.key] as string | number" :type="field.type === 'number' ? 'number' : 'text'" @input="scheduleSave(row)" @blur="saveNow(row)">
          </template>
          <div class="row-actions"><button class="danger ghost delete-icon" :disabled="busy" title="삭제" aria-label="삭제" @click="remove(row)">×</button></div>
        </div>
        <div v-if="!visibleRows.length" class="reference-empty">{{ query ? '검색 결과가 없습니다.' : '등록된 기준정보가 없습니다. 새 행을 추가해 주세요.' }}</div>
      </div>
    </div>
  </section>
</template>
