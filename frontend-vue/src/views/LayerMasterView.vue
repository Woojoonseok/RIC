<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import SpreadsheetGrid from "../components/grid/SpreadsheetGrid.vue";
import { cloneJson } from "../domain/clone";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";
import type { LayerMasterCreate } from "../types";

type Row = Record<string, unknown>;
const app = useAppStore(); const graph = useGraphStore(); const project = useProjectStore(); const reference = useReferenceStore();
const selected = ref<string[]>([]);
const columns = computed(() => [
  { key: "name", label: "Layer 명", width: 180 }, { key: "layer_number", label: "Layer 번호", width: 120 },
  { key: "mask_main_fld", label: "Mask MAIN FLD", width: 140 }, { key: "mask_sl_fld", label: "Mask SL FLD", width: 130 },
  { key: "pr_wf", label: "Mask PR", width: 110 }, { key: "dev_wf", label: "WF Dev", width: 110 },
  { key: "pr_type", label: "WF PR종류", width: 120 }, { key: "light_source", label: "광원", width: 100 },
  { key: "pr_open_close", label: "PR Open/Close", width: 130 },
  ...reference.keyLayoutTypes.map((layout) => ({ key: `priority:${layout.id}`, label: `우선순위 ${layout.name}`, width: 145 })),
  { key: "validation_rule", label: "검증 Rule", width: 180 }, { key: "comment", label: "Comment", width: 220 },
]);
const rows = computed<Row[]>(() => reference.layerMasters.map((master) => ({
  ...master,
  ...Object.fromEntries(reference.keyLayoutTypes.map((layout) => [`priority:${layout.id}`, master.priorities[layout.id] ?? ""])),
})));

async function load() { await reference.loadAll() }
function selectRow(id: string, additive: boolean) {
  if (!additive) selected.value = [id];
  else selected.value = selected.value.includes(id) ? selected.value.filter((item) => item !== id) : [...selected.value, id];
}
async function commit(nextRows: Row[]) {
  for (const row of nextRows) {
    const priorities = Object.fromEntries(reference.keyLayoutTypes.map((layout) => [layout.id, String(row[`priority:${layout.id}`] || "") || null]));
    const body: LayerMasterCreate = {
      name: String(row.name || "").trim(), layer_number: String(row.layer_number || "") || null,
      mask_main_fld: String(row.mask_main_fld || "") || null, mask_sl_fld: String(row.mask_sl_fld || "") || null,
      pr_wf: String(row.pr_wf || "") || null, dev_wf: String(row.dev_wf || "") || null,
      pr_type: String(row.pr_type || "") || null, light_source: String(row.light_source || "") || null,
      pr_open_close: String(row.pr_open_close || "") || null, validation_rule: String(row.validation_rule || "") || null,
      comment: String(row.comment || "") || null, priorities,
    };
    if (!body.name) continue;
    if (row.id) await api.updateLayerMaster(String(row.id), body); else await api.createLayerMaster(body);
  }
  await load(); app.status = "Layer 정보 저장 완료";
}
async function removeSelected() {
  if (!selected.value.length || !confirm(`${selected.value.length}개 Layer 정보를 삭제할까요?`)) return;
  for (const id of selected.value) await api.deleteLayerMaster(id);
  selected.value = []; await load();
}
async function createLayer() {
  const master = reference.layerMasters.find((row) => row.id === selected.value[0]);
  if (!master || !project.projectId) return;
  await graph.mutateGraph("Master에서 Layer 생성", () => api.createLayer(project.projectId, {
    name: master.name, step: master.layer_number, metadata_json: { layer_master: cloneJson(master) },
  }));
  app.view = "editor";
}
onMounted(load);
</script>

<template>
  <section class="page wide-page">
    <div class="page-title"><div><p class="eyebrow">PROCESS SOURCE OF TRUTH</p><h1>Layer 정보</h1><p>Key 배치 Type 기준정보에 따라 우선순위 컬럼이 자동으로 증감합니다.</p></div><div class="button-strip"><button :disabled="selected.length !== 1 || !project.projectId" @click="createLayer">선택 Layer 생성</button><button class="danger" :disabled="!selected.length" @click="removeSelected">삭제</button></div></div>
    <div class="panel data-panel"><SpreadsheetGrid :columns="columns" :rows="rows" :selected-rows="selected" empty-hint="Layer Master 행을 추가하세요." @row-select="selectRow" @commit="commit"/></div>
  </section>
</template>
