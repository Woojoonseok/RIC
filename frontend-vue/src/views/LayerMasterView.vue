<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardPaste, Download, Plus, Search, Trash2, Users, X } from "@lucide/vue";
import { api } from "../api/client";
import SpreadsheetGrid from "../components/grid/SpreadsheetGrid.vue";
import { filterLayerMasterRows, layerMasterBaseColumns, layerMasterColumns, layerMasterPasteRows, layerMasterPayload, layerMasterPriorityColumns, layerMasterRows } from "../domain/layerMaster";
import { parseTsv } from "../domain/tsv";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";
import type { LayerMaster, LayerMasterImportPreview, LayerMasterImportRequest } from "../types";

type Row = Record<string, unknown>;
interface PastePreview extends LayerMasterImportPreview { request: LayerMasterImportRequest }
const app = useAppStore();
const project = useProjectStore();
const reference = useReferenceStore();
const selected = ref<string[]>([]);
const grid = ref<InstanceType<typeof SpreadsheetGrid> | null>(null);
const pasteOpen = ref(false);
const pasteText = ref("");
const pasteBusy = ref(false);
const pastePreview = ref<PastePreview | null>(null);
const busy = ref(false);
const status = ref("준비");
const activeTab = ref<"basic" | "priorities">("basic");
const basicQuery = ref("");
const priorityQuery = ref("");
const basicColumnFilters = ref<Record<string, string[]>>({});
const priorityColumnFilters = ref<Record<string, string[]>>({});
const activeFilterKey = ref<string | null>(null);
const filterDraft = ref<string[]>([]);
const filterSearch = ref("");
const filterMenuPosition = ref({ top: 0, left: 0 });
const persistedRows = new Map<string, string>();
const pendingCreates = new Map<string, Promise<LayerMaster>>();
let writeQueue: Promise<void> = Promise.resolve();
let activeSaves = 0;
let saveHadError = false;
const basicColumns = computed(() => layerMasterBaseColumns(reference.boxPresets));
const priorityColumns = computed(() => layerMasterPriorityColumns(reference.keyLayoutTypes));
const importColumns = computed(() => layerMasterColumns(reference.keyLayoutTypes, reference.boxPresets));
const rows = computed<Row[]>(() => layerMasterRows(reference.layerMasters, reference.keyLayoutTypes, reference.boxPresets));
const basicRows = computed(() => filterLayerMasterRows(rows.value, basicColumns.value, basicQuery.value, basicColumnFilters.value));
const priorityRows = computed(() => filterLayerMasterRows(rows.value, priorityColumns.value, priorityQuery.value, priorityColumnFilters.value));
const activeColumns = computed(() => activeTab.value === "basic" ? basicColumns.value : priorityColumns.value);
const activeFilters = computed(() => activeTab.value === "basic" ? basicColumnFilters.value : priorityColumnFilters.value);
const activeQuery = computed(() => activeTab.value === "basic" ? basicQuery.value : priorityQuery.value);
const activeFilterValues = computed(() => {
  if (!activeFilterKey.value) return [];
  return [...new Set(filterLayerMasterRows(
    rows.value,
    activeColumns.value,
    activeQuery.value,
    activeFilters.value,
    activeFilterKey.value,
  ).map((row) => String(row[activeFilterKey.value!] ?? "")))]
    .sort((left, right) => left.localeCompare(right, "ko", { numeric: true, sensitivity: "base" }));
});
const searchedFilterValues = computed(() => {
  const needle = filterSearch.value.trim().toLocaleLowerCase("ko");
  return needle
    ? activeFilterValues.value.filter((value) => value.toLocaleLowerCase("ko").includes(needle))
    : activeFilterValues.value;
});
const activeFilterLabel = computed(() => activeColumns.value.find((column) => column.key === activeFilterKey.value)?.label ?? "컬럼");
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
async function waitForPendingSaves() {
  while (activeSaves > 0) {
    await writeQueue;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
}
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (activeSaves <= 0) return;
  event.preventDefault();
  event.returnValue = "";
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
function openColumnFilter(key: string, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  activeFilterKey.value = key;
  filterSearch.value = "";
  filterDraft.value = activeFilters.value[key] ? [...activeFilters.value[key]] : [...activeFilterValues.value];
  filterMenuPosition.value = {
    top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 360)),
    left: Math.max(12, Math.min(rect.right - 280, window.innerWidth - 292)),
  };
}
function closeColumnFilter() { activeFilterKey.value = null }
function toggleFilterValue(value: string) {
  filterDraft.value = filterDraft.value.includes(value)
    ? filterDraft.value.filter((item) => item !== value)
    : [...filterDraft.value, value];
}
function updateActiveFilters(next: Record<string, string[]>) {
  if (activeTab.value === "basic") basicColumnFilters.value = next;
  else priorityColumnFilters.value = next;
}
function applyColumnFilter() {
  if (!activeFilterKey.value) return;
  const key = activeFilterKey.value;
  const allSelected = filterDraft.value.length === activeFilterValues.value.length
    && activeFilterValues.value.every((value) => filterDraft.value.includes(value));
  const { [key]: _removed, ...rest } = activeFilters.value;
  updateActiveFilters(allSelected ? rest : { ...rest, [key]: [...filterDraft.value] });
  closeColumnFilter();
}
function clearColumnFilter() {
  if (!activeFilterKey.value) return;
  const { [activeFilterKey.value]: _removed, ...rest } = activeFilters.value;
  updateActiveFilters(rest);
  closeColumnFilter();
}
function filterLabel(value: string) { return value || "(빈 셀)" }
async function addLayerRow() {
  activeTab.value = "basic";
  await nextTick();
  grid.value?.addDraftRow();
}
function openPriorities(row: Row) {
  priorityQuery.value = String(row.layer_number || row.name || "");
  activeTab.value = "priorities";
}
async function commit(nextRows: Row[], rowIndexes: number[] = []) {
  if (!project.canEdit) return;
  let completed = 0;
  const missingNumber = nextRows.find(
    (row) => String(row.name || "").trim() && !String(row.layer_number || "").trim(),
  );
  if (missingNumber) {
    status.value = "Layer 번호는 필수입니다.";
    app.status = status.value;
    return;
  }
  const targets = nextRows
    .map((row, index) => ({ row, rowIndex: rowIndexes[index] ?? index }))
    .filter(({ row }) => String(row.name || "").trim() && (!row.id || persistedRows.get(String(row.id)) !== rowSignature(row)));
  if (!targets.length) {
    status.value = "변경사항 없음";
    return;
  }
  if (activeSaves === 0) saveHadError = false;
  activeSaves += 1;
  busy.value = true;
  project.markSaving();
  try {
    for (const { row, rowIndex } of targets) {
      const body = layerMasterPayload(row, reference.keyLayoutTypes);
      let saved: LayerMaster;
      if (row.id) {
        saved = await enqueueWrite(() => api.updateLayerMaster(String(row.id), body));
      } else {
        const key = String(row.__gridKey || `row-${rowIndex}`);
        const pending = pendingCreates.get(key);
        const create = pending ?? enqueueWrite(() => api.createLayerMaster(body));
        if (!pending) pendingCreates.set(key, create);
        try {
          const created = await create;
          saved = pending
            ? await enqueueWrite(() => api.updateLayerMaster(created.id, body))
            : created;
        } finally {
          if (!pending && pendingCreates.get(key) === create) pendingCreates.delete(key);
        }
      }
      reference.syncLayerMaster(saved);
      persistedRows.set(saved.id, JSON.stringify(body));
      const normalized = layerMasterRows([saved], reference.keyLayoutTypes, reference.boxPresets)[0];
      grid.value?.acceptSavedRow(rowIndex, row, normalized);
      completed += 1;
    }
    status.value = `${completed}개 Layer 정보 저장 완료`;
  } catch (error) {
    saveHadError = true;
    status.value = `${completed}/${targets.length}개 저장 후 실패: ${error instanceof Error ? error.message : String(error)}`;
    project.handleMutationError(error);
  } finally {
    activeSaves -= 1;
    busy.value = activeSaves > 0;
    if (!busy.value && !saveHadError) project.markSaved();
    app.status = status.value;
  }
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
  return layerMasterPasteRows(matrix, basicColumns.value, importColumns.value);
}
function layerMasterImportRequest(sourceRows: Row[]): LayerMasterImportRequest {
  return {
    rows: sourceRows.map((row, index) => ({
      row_number: index + 1,
      layer: layerMasterPayload(row, reference.keyLayoutTypes),
    })),
  };
}
async function previewPaste() {
  const sourceRows = rowsFromMatrix(parseTsv(pasteText.value));
  if (!sourceRows.length) {
    app.status = "붙여넣을 Layer 정보가 없습니다.";
    return;
  }
  const request = layerMasterImportRequest(sourceRows);
  pasteBusy.value = true;
  try {
    pastePreview.value = { ...await api.previewLayerMasterImport(request), request };
  } catch (error) {
    project.handleMutationError(error);
    app.status = error instanceof Error ? error.message : String(error);
  } finally {
    pasteBusy.value = false;
  }
}
async function commitPaste() {
  if (!pastePreview.value || pastePreview.value.error_count || !pastePreview.value.create_count) return;
  pasteBusy.value = true;
  project.markSaving();
  try {
    const result = await api.commitLayerMasterImport(pastePreview.value.request);
    for (const row of result.rows) {
      reference.syncLayerMaster(row);
      persistedRows.set(row.id, rowSignature(layerMasterRows([row], reference.keyLayoutTypes, reference.boxPresets)[0]));
    }
    project.markSaved();
    app.status = `Layer 정보 ${result.created_count}개 Import 완료`;
    status.value = `${result.created_count}개 Layer 정보 저장 완료`;
    pasteOpen.value = false;
    pasteText.value = "";
  } catch (error) {
    project.handleMutationError(error);
    app.status = error instanceof Error ? error.message : String(error);
  } finally {
    pasteBusy.value = false;
  }
}
async function downloadTemplate() {
  const XLSX = await import("xlsx-js-style");
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
watch(pasteText, () => { pastePreview.value = null });
onBeforeRouteLeave(async () => {
  await waitForPendingSaves();
  return true;
});
onMounted(() => window.addEventListener("beforeunload", warnBeforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", warnBeforeUnload));
</script>

<template>
  <section class="page wide-page layer-master-page">
    <div class="page-title">
      <div><p class="eyebrow">PROJECT LAYER DATA</p><h1>Layer 정보</h1><p>{{ project.currentProject?.name }} 프로젝트의 Layer 기준정보입니다. Editor에는 필요한 Layer만 직접 가져올 수 있습니다.</p></div>
      <span class="status-pill" :class="{ busy }">{{ !project.canEdit ? '보기 전용' : busy ? '처리 중…' : status }}</span>
    </div>
    <div v-if="reference.loading && !reference.loaded" class="panel data-loading">Layer 정보를 불러오는 중입니다.</div>
    <div v-else-if="reference.loadError && !reference.loaded" class="panel data-error"><p>{{ reference.loadError }}</p><button @click="load">다시 시도</button></div>
    <template v-else>
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
      <button :class="{ active: activeTab === 'basic' }" @click="activeTab = 'basic'; priorityQuery = ''; closeColumnFilter()">
        <span>Layer 기본정보</span><b>{{ rows.length }}</b>
      </button>
      <button :class="{ active: activeTab === 'priorities' }" @click="activeTab = 'priorities'; closeColumnFilter()">
        <span>Key 우선순위</span><b>{{ priorityValueCount }}/{{ priorityCellCount }}</b>
      </button>
      <label class="layer-master-filter">
        <Search :size="16"/>
        <input
          v-if="activeTab === 'basic'"
          v-model="basicQuery"
          placeholder="Layer 정보 전체 검색"
          aria-label="Layer 기본정보 필터"
        >
        <input
          v-else
          v-model="priorityQuery"
          placeholder="Layer 및 우선순위 검색"
          aria-label="Key 우선순위 필터"
        >
        <span v-if="activeTab === 'basic' ? basicQuery : priorityQuery" class="layer-filter-count">
          {{ activeTab === 'basic' ? basicRows.length : priorityRows.length }}/{{ rows.length }}
        </span>
        <button
          v-if="activeTab === 'basic' ? basicQuery : priorityQuery"
          type="button"
          title="필터 지우기"
          aria-label="필터 지우기"
          @click="activeTab === 'basic' ? basicQuery = '' : priorityQuery = ''"
        ><X :size="15"/></button>
      </label>
    </nav>
    <div class="sheet-help">셀 선택 후 바로 입력 또는 Enter/F2로 편집 · Ctrl+C / Ctrl+V로 Excel 범위 복사·붙여넣기 · 행 번호를 클릭해 선택</div>
    <div v-if="activeTab === 'basic'" class="panel data-panel">
      <SpreadsheetGrid
        ref="grid"
        :columns="basicColumns"
        :rows="basicRows"
        :selected-rows="selected"
        select-all-rows
        filterable
        :filtered-columns="Object.keys(basicColumnFilters)"
        :readonly="!project.canEdit"
        :auto-commit="true"
        :empty-hint="basicQuery ? '필터 조건에 맞는 Layer가 없습니다.' : 'Layer를 추가하세요.'"
        @row-select="selectRow"
        @row-selection="setSelectedRows"
        @column-filter="openColumnFilter"
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
        select-all-rows
        filterable
        :filtered-columns="Object.keys(priorityColumnFilters)"
        :readonly="!project.canEdit"
        :auto-commit="true"
        :empty-hint="priorityQuery ? '필터 조건에 맞는 Layer가 없습니다.' : 'Key Layout Type을 추가하면 우선순위 열이 표시됩니다.'"
        @row-select="selectRow"
        @row-selection="setSelectedRows"
        @column-filter="openColumnFilter"
        @commit="commit"
      />
    </div>

    <div v-if="pasteOpen" class="paste-overlay" @click="pasteOpen = false">
      <section class="panel paste-panel relation-import-panel" @click.stop>
        <div class="panel-heading"><div><p class="eyebrow">ATOMIC IMPORT</p><h2>Layer 정보 Paste</h2></div><button @click="pasteOpen = false">닫기</button></div>
        <textarea v-model="pasteText" autofocus placeholder="Excel에서 복사한 표를 여기에 붙여넣으세요."/>
        <div v-if="pastePreview" class="relation-import-preview" :class="{ invalid: pastePreview.error_count }">
          <div class="relation-import-summary">
            <div><span>입력 행</span><b>{{ pastePreview.total_count }}</b></div>
            <div><span>생성 Layer</span><b>{{ pastePreview.create_count }}</b></div>
            <div><span>오류</span><b>{{ pastePreview.error_count }}</b></div>
          </div>
          <div v-if="pastePreview.issues.length" class="relation-import-issues">
            <div v-for="(issue, index) in pastePreview.issues" :key="`${issue.row_number}-${issue.code}-${index}`">
              <AlertTriangle :size="16"/>
              <span><strong>{{ issue.row_number ? `${issue.row_number}행` : '전체' }} · {{ issue.code }}</strong><small>{{ issue.message }}</small></span>
            </div>
          </div>
          <div v-else class="relation-import-ready"><CheckCircle2 :size="18"/><span>검증이 완료되었습니다. 저장하면 모든 Layer 정보가 한 번에 반영됩니다.</span></div>
        </div>
        <div class="sheet-actions">
          <button :disabled="pasteBusy" @click="pasteOpen = false">취소</button>
          <button :disabled="pasteBusy || !pasteText.trim()" @click="previewPaste">{{ pasteBusy && !pastePreview ? '검증 중…' : '미리보기' }}</button>
          <button class="primary" :disabled="pasteBusy || !pastePreview || pastePreview.error_count > 0 || !pastePreview.create_count" @click="commitPaste">
            {{ pasteBusy && pastePreview ? '저장 중…' : `${pastePreview?.create_count ?? 0}개 저장` }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="activeFilterKey" class="final-table-filter-backdrop" @click="closeColumnFilter"/>
    <section
      v-if="activeFilterKey"
      class="final-table-filter-menu"
      :style="{ top: `${filterMenuPosition.top}px`, left: `${filterMenuPosition.left}px` }"
      @click.stop
    >
      <div class="final-table-filter-heading">
        <strong>{{ activeFilterLabel }} 필터</strong>
        <button type="button" title="닫기" aria-label="필터 닫기" @click="closeColumnFilter"><X :size="16"/></button>
      </div>
      <label class="final-table-filter-search">
        <Search :size="15"/>
        <input v-model="filterSearch" placeholder="값 검색">
      </label>
      <div class="final-table-filter-tools">
        <button type="button" @click="filterDraft = [...activeFilterValues]">모두 선택</button>
        <button type="button" @click="filterDraft = []">선택 해제</button>
      </div>
      <div class="final-table-filter-values">
        <label v-for="option in searchedFilterValues" :key="option">
          <input type="checkbox" :checked="filterDraft.includes(option)" @change="toggleFilterValue(option)">
          <span>{{ filterLabel(option) }}</span>
        </label>
        <p v-if="!searchedFilterValues.length">검색 결과가 없습니다.</p>
      </div>
      <div class="final-table-filter-actions">
        <button type="button" @click="clearColumnFilter">필터 해제</button>
        <button type="button" class="primary" @click="applyColumnFilter">적용</button>
      </div>
    </section>
    </template>
  </section>
</template>
