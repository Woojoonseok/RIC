<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ChevronDown, ClipboardPaste, Download, Plus, Trash2, Users } from "@lucide/vue";
import * as XLSX from "xlsx-js-style";
import { api } from "../api/client";
import SpreadsheetGrid from "../components/grid/SpreadsheetGrid.vue";
import { layerMasterBaseColumns, layerMasterColumns, layerMasterPayload, layerMasterPriorityColumns, layerMasterRows } from "../domain/layerMaster";
import { parseTsv } from "../domain/tsv";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";

type Row = Record<string, unknown>;
const app = useAppStore();
const project = useProjectStore();
const reference = useReferenceStore();
const selected = ref<string[]>([]);
const grid = ref<InstanceType<typeof SpreadsheetGrid> | null>(null);
const pasteOpen = ref(false);
const pasteText = ref("");
const busy = ref(false);
const status = ref("준비");
const activeTab = ref<"basic" | "priorities">("basic");
const priorityQuery = ref("");
const persistedRows = new Map<string, string>();
let writeQueue: Promise<void> = Promise.resolve();
const basicColumns = computed(() => layerMasterBaseColumns(reference.boxPresets));
const priorityColumns = computed(() => layerMasterPriorityColumns(reference.keyLayoutTypes));
const importColumns = computed(() => layerMasterColumns(reference.keyLayoutTypes, reference.boxPresets));
const rows = computed<Row[]>(() => layerMasterRows(reference.layerMasters, reference.keyLayoutTypes, reference.boxPresets));
const priorityRows = computed(() => {
  const needle = priorityQuery.value.trim().toLowerCase();
  if (!needle) return rows.value;
  return rows.value.filter((row) => (
    String(row.layer_number ?? "").toLowerCase().includes(needle)
    || String(row.name ?? "").toLowerCase().includes(needle)
  ));
});
const priorityValueCount = computed(() => rows.value.reduce((total, row) => (
  total + reference.keyLayoutTypes.filter((layout) => String(row[`priority:${layout.id}`] ?? "").trim()).length
), 0));
const priorityCellCount = computed(() => rows.value.length * reference.keyLayoutTypes.length);

function rowSignature(row: Row) {
  return JSON.stringify(layerMasterPayload(row, reference.keyLayoutTypes));
}
function rememberRows() {
  persistedRows.clear();
  for (const row of rows.value) if (row.id) persistedRows.set(String(row.id), rowSignature(row));
}
function enqueueWrite<T>(job: () => Promise<T>) {
  const run = writeQueue.then(job, job);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}
async function load() {
  await reference.loadAll();
  rememberRows();
}
function selectRow(id: string, additive: boolean) {
  if (!additive) selected.value = [id];
  else selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id];
}
function setSelectedRows(ids: string[]) { selected.value = ids }
async function addLayerRow() {
  activeTab.value = "basic";
  await nextTick();
  grid.value?.addDraftRow();
}
function openPriorities(row: Row) {
  priorityQuery.value = String(row.layer_number || row.name || "");
  activeTab.value = "priorities";
}
async function commit(nextRows: Row[]) {
  if (!project.canEdit) return;
  busy.value = true;
  project.markSaving();
  let completed = 0;
  const missingNumber = nextRows.find(
    (row) => String(row.name || "").trim() && !String(row.layer_number || "").trim(),
  );
  if (missingNumber) {
    busy.value = false;
    status.value = "Layer 번호는 필수입니다.";
    app.status = status.value;
    project.markSaved();
    return;
  }
  const targets = nextRows.filter((row) => String(row.name || "").trim() && (!row.id || persistedRows.get(String(row.id)) !== rowSignature(row)));
  if (!targets.length) {
    busy.value = false;
    status.value = "변경사항 없음";
    project.markSaved();
    return;
  }
  try {
    for (const row of targets) {
      const body = layerMasterPayload(row, reference.keyLayoutTypes);
      const saved = row.id
        ? await enqueueWrite(() => api.updateLayerMaster(String(row.id), body))
        : await enqueueWrite(() => api.createLayerMaster(body));
      reference.syncLayerMaster(saved);
      persistedRows.set(saved.id, JSON.stringify(body));
      completed += 1;
    }
    status.value = `${completed}개 Layer 정보 저장 완료`;
    project.markSaved();
  } catch (error) {
    status.value = `${completed}/${targets.length}개 저장 후 실패: ${error instanceof Error ? error.message : String(error)}`;
    project.handleMutationError(error);
  } finally { busy.value = false; app.status = status.value }
}
async function groupSelected() {
  if (!project.canEdit || selected.value.length < 2) return;
  const label = prompt("그룹 이름", `Group ${new Set(reference.layerMasters.map((row) => row.group).filter(Boolean)).size + 1}`)?.trim();
  if (!label) return;
  busy.value = true;
  project.markSaving();
  let completed = 0;
  try {
    for (const id of selected.value) {
      const saved = await enqueueWrite(() => api.updateLayerMaster(id, { group: label }));
      reference.syncLayerMaster(saved);
      persistedRows.set(saved.id, rowSignature(layerMasterRows([saved], reference.keyLayoutTypes, reference.boxPresets)[0]));
      completed += 1;
    }
    grid.value?.refresh();
    status.value = `${completed}개 Layer를 ${label} 그룹으로 설정`;
    project.markSaved();
  } catch (error) {
    status.value = `${completed}/${selected.value.length}개 Group 설정 후 실패: ${error instanceof Error ? error.message : String(error)}`;
    project.handleMutationError(error);
  } finally {
    busy.value = false;
    app.status = status.value;
  }
}
async function removeSelected() {
  if (!project.canEdit || !selected.value.length || !confirm(`${selected.value.length}개 Layer 정보를 삭제할까요?`)) return;
  busy.value = true;
  project.markSaving();
  try {
    const ids = [...selected.value];
    for (const id of ids) await enqueueWrite(() => api.deleteLayerMaster(id));
    reference.removeLayerMasters(ids);
    ids.forEach((id) => persistedRows.delete(id));
    status.value = `${ids.length}개 삭제 완료`;
    selected.value = [];
    project.markSaved();
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
    project.handleMutationError(error);
  } finally {
    busy.value = false;
  }
}
function rowsFromMatrix(matrix: unknown[][]): Row[] {
  const keys = importColumns.value.map((column) => column.key);
  return matrix
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ""])));
}
async function applyPaste() {
  await commit(rowsFromMatrix(parseTsv(pasteText.value)));
  pasteOpen.value = false;
  pasteText.value = "";
}
function downloadTemplate() {
  const worksheet = XLSX.utils.aoa_to_sheet([
    importColumns.value.map((column) => column.label),
  ]);
  worksheet["!cols"] = importColumns.value.map((column) => ({
    wch: Math.max(14, Math.round((column.width ?? 120) / 8)),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Layer Information");
  XLSX.writeFile(workbook, "RIC_Layer_Information_Template.xlsx");
  app.status = "Layer 정보 템플릿을 다운로드했습니다.";
}
watch(
  () => project.currentProjectId,
  (projectId) => { if (projectId) void load() },
  { immediate: true },
);
</script>

<template>
  <section class="page wide-page layer-master-page">
    <div class="page-title">
      <div><p class="eyebrow">PROJECT LAYER DATA</p><h1>Layer 정보</h1><p>{{ project.currentProject?.name }} 프로젝트의 Layer 기준정보입니다. Editor에는 필요한 Layer만 직접 가져올 수 있습니다.</p></div>
      <span class="status-pill" :class="{ busy }">{{ !project.canEdit ? '보기 전용' : busy ? '처리 중…' : status }}</span>
    </div>
    <div class="layer-master-summary panel">
      <div class="layer-master-metrics">
        <div><b>{{ reference.layerMasters.length }}</b><span>등록 Layer</span></div>
        <div><b>{{ reference.keyLayoutTypes.length }}</b><span>우선순위 기준</span></div>
        <div><b>{{ selected.length }}</b><span>선택 행</span></div>
      </div>
      <div class="layer-master-actions">
        <button class="primary layer-add-button" :disabled="busy || !project.canEdit" @click="addLayerRow"><Plus :size="16"/>Layer 추가</button>
        <div class="layer-action-group" aria-label="선택 항목 작업">
          <button :disabled="selected.length < 2 || busy || !project.canEdit" @click="groupSelected"><Users :size="15"/>그룹 설정 <span v-if="selected.length">{{ selected.length }}</span></button>
          <button class="danger ghost" :disabled="!selected.length || busy || !project.canEdit" @click="removeSelected"><Trash2 :size="15"/>삭제</button>
        </div>
        <span class="layer-action-divider"/>
        <details class="action-menu">
          <summary>데이터 도구<ChevronDown :size="14"/></summary>
          <div>
            <button type="button" :disabled="busy" @click="downloadTemplate"><Download :size="15"/>템플릿 다운로드</button>
            <button type="button" :disabled="busy || !project.canEdit" @click="pasteOpen = true"><ClipboardPaste :size="15"/>표 붙여넣기</button>
          </div>
        </details>
      </div>
    </div>
    <nav class="resource-tabs layer-master-tabs" aria-label="Layer 정보 보기">
      <button :class="{ active: activeTab === 'basic' }" @click="activeTab = 'basic'; priorityQuery = ''">
        <span>Layer 기본정보</span><b>{{ rows.length }}</b>
      </button>
      <button :class="{ active: activeTab === 'priorities' }" @click="activeTab = 'priorities'">
        <span>Key 우선순위</span><b>{{ priorityValueCount }}/{{ priorityCellCount }}</b>
      </button>
      <input v-if="activeTab === 'priorities'" v-model="priorityQuery" class="layer-priority-search" placeholder="Layer 번호 또는 이름 검색">
    </nav>
    <div class="sheet-help">셀 선택 후 바로 입력 또는 Enter/F2로 편집 · Ctrl+C / Ctrl+V로 Excel 범위 복사·붙여넣기 · 행 번호를 클릭해 선택</div>
    <div v-if="activeTab === 'basic'" class="panel data-panel">
      <SpreadsheetGrid
        ref="grid"
        :columns="basicColumns"
        :rows="rows"
        :selected-rows="selected"
        :readonly="!project.canEdit"
        :auto-commit="true"
        empty-hint="Layer를 추가하세요."
        @row-select="selectRow"
        @row-selection="setSelectedRows"
        @cell-action="openPriorities"
        @commit="commit"
      />
    </div>
    <div v-else class="panel data-panel priority-matrix-panel">
      <SpreadsheetGrid
        ref="grid"
        :columns="priorityColumns"
        :rows="priorityRows"
        :selected-rows="selected"
        :readonly="!project.canEdit"
        :auto-commit="true"
        empty-hint="Key Layout Type을 추가하면 우선순위 열이 표시됩니다."
        @row-select="selectRow"
        @row-selection="setSelectedRows"
        @commit="commit"
      />
    </div>

    <div v-if="pasteOpen" class="paste-overlay" @click="pasteOpen = false">
      <section class="panel paste-panel" @click.stop>
        <div class="panel-heading"><h2>Layer 정보 Paste</h2><button @click="pasteOpen = false">닫기</button></div>
        <textarea v-model="pasteText" autofocus placeholder="Excel에서 복사한 표를 여기에 붙여넣으세요."/>
        <div class="sheet-actions"><button class="primary" @click="applyPaste">적용</button></div>
      </section>
    </div>
  </section>
</template>
