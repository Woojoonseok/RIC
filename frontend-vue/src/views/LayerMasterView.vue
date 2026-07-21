<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api/client";
import SpreadsheetGrid from "../components/grid/SpreadsheetGrid.vue";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";
import type { LayerMasterCreate } from "../types";

type Row = Record<string, unknown>;
const app = useAppStore(); const project = useProjectStore(); const reference = useReferenceStore();
const selected = ref<string[]>([]);
const grid = ref<InstanceType<typeof SpreadsheetGrid> | null>(null);
const busy = ref(false);
const status = ref("준비");
const defaultBoxPreset = computed(() => reference.boxPresets.find((preset) => preset.is_default) ?? reference.boxPresets[0]);
const columns = computed(() => [
  { key: "name", label: "Layer 명", width: 180 }, { key: "layer_number", label: "Layer 번호", width: 120 },
  { key: "mask_main_fld", label: "Mask MAIN FLD", width: 140 }, { key: "mask_sl_fld", label: "Mask SL FLD", width: 130 },
  { key: "pr_wf", label: "Mask PR", width: 110 }, { key: "dev_wf", label: "WF Dev", width: 110 },
  { key: "pr_type", label: "WF PR종류", width: 120 },
  { key: "light_source", label: "광원", width: 150, options: reference.boxPresets.map((preset) => ({ value: preset.name, label: preset.is_default ? `${preset.name} (기본)` : preset.name })), defaultValue: defaultBoxPreset.value?.name ?? "" },
  { key: "pr_open_close", label: "PR Open/Close", width: 130 },
  ...reference.keyLayoutTypes.map((layout) => ({ key: `priority:${layout.id}`, label: `우선순위 ${layout.name}`, width: 145 })),
  { key: "validation_rule", label: "검증 Rule", width: 180 }, { key: "comment", label: "Comment", width: 220 },
]);
const rows = computed<Row[]>(() => reference.layerMasters.map((master) => ({
  ...master,
  light_source: master.light_source || defaultBoxPreset.value?.name || "",
  ...Object.fromEntries(reference.keyLayoutTypes.map((layout) => [`priority:${layout.id}`, master.priorities[layout.id] ?? ""])),
})));

async function load() { await reference.loadAll() }
function selectRow(id: string, additive: boolean) {
  if (!additive) selected.value = [id];
  else selected.value = selected.value.includes(id) ? selected.value.filter((item) => item !== id) : [...selected.value, id];
}
function setSelectedRows(ids: string[]) { selected.value = ids }
async function commit(nextRows: Row[]) {
  if (!project.canEdit) return;
  busy.value = true;
  project.markSaving();
  let completed = 0;
  const targets = nextRows.filter((row) => String(row.name || "").trim());
  try {
    for (const row of targets) {
      const priorities = Object.fromEntries(reference.keyLayoutTypes.map((layout) => [layout.id, String(row[`priority:${layout.id}`] || "") || null]));
      const body: LayerMasterCreate = {
        name: String(row.name || "").trim(), layer_number: String(row.layer_number || "") || null,
        mask_main_fld: String(row.mask_main_fld || "") || null, mask_sl_fld: String(row.mask_sl_fld || "") || null,
        pr_wf: String(row.pr_wf || "") || null, dev_wf: String(row.dev_wf || "") || null,
        pr_type: String(row.pr_type || "") || null, light_source: String(row.light_source || "") || null,
        pr_open_close: String(row.pr_open_close || "") || null, validation_rule: String(row.validation_rule || "") || null,
        comment: String(row.comment || "") || null, priorities,
      };
      if (row.id) await api.updateLayerMaster(String(row.id), body); else await api.createLayerMaster(body);
      completed += 1;
    }
    status.value = `${completed}개 Layer 정보 저장 완료`;
    project.markSaved();
  } catch (error) {
    status.value = `${completed}/${targets.length}개 저장 후 실패: ${error instanceof Error ? error.message : String(error)}`;
    project.handleMutationError(error);
  } finally {
    await load(); busy.value = false; app.status = status.value;
  }
}
async function removeSelected() {
  if (!project.canEdit || !selected.value.length || !confirm(`${selected.value.length}개 Layer 정보를 삭제할까요?`)) return;
  busy.value = true;
  project.markSaving();
  try {
    for (const id of selected.value) await api.deleteLayerMaster(id);
    status.value = `${selected.value.length}개 삭제 완료`;
    selected.value = []; await load();
    project.markSaved();
  } catch (error) { status.value = error instanceof Error ? error.message : String(error); project.handleMutationError(error) }
  finally { busy.value = false }
}
onMounted(load);
</script>

<template>
  <section class="page wide-page layer-master-page">
    <div class="page-title"><div><p class="eyebrow">PROJECT LAYER DATA</p><h1>Layer 정보</h1><p>{{ project.currentProject?.name }} 프로젝트의 Layer 기준입니다. 셀 변경은 즉시 저장됩니다.</p></div><span class="status-pill" :class="{ busy }">{{ !project.canEdit ? '보기 전용' : busy ? '처리 중…' : status }}</span></div>
    <div class="layer-master-summary panel">
      <div><b>{{ reference.layerMasters.length }}</b><span>등록 Layer</span></div><div><b>{{ reference.keyLayoutTypes.length }}</b><span>우선순위 기준</span></div><div><b>{{ selected.length }}</b><span>선택 행</span></div>
      <div class="button-strip"><button class="primary" :disabled="busy || !project.canEdit" @click="grid?.addDraftRow()">새 Layer 정보</button><button class="danger" :disabled="!selected.length || busy || !project.canEdit" @click="removeSelected">선택 삭제</button></div>
    </div>
    <div class="sheet-help">셀 더블클릭 또는 F2로 편집 · Ctrl+C / Ctrl+V로 Excel 범위 복사·붙여넣기 · 행 번호를 클릭해 선택</div>
    <div class="panel data-panel"><SpreadsheetGrid ref="grid" :columns="columns" :rows="rows" :selected-rows="selected" :readonly="!project.canEdit" :auto-commit="true" empty-hint="새 Layer 정보를 추가하세요." @row-select="selectRow" @row-selection="setSelectedRows" @commit="commit"/></div>
  </section>
</template>
