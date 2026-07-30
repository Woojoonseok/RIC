<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as XLSX from "xlsx";
import { api } from "../api/client";
import SpreadsheetGrid from "../components/grid/SpreadsheetGrid.vue";
import { layerMasterColumns, layerMasterPayload, layerMasterRows } from "../domain/layerMaster";
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
const upload = ref<HTMLInputElement | null>(null);
const pasteOpen = ref(false);
const pasteText = ref("");
const busy = ref(false);
const status = ref("준비");
const persistedRows = new Map<string, string>();
let writeQueue: Promise<void> = Promise.resolve();
const columns = computed(() => layerMasterColumns(reference.keyLayoutTypes, reference.boxPresets));
const rows = computed<Row[]>(() => layerMasterRows(reference.layerMasters, reference.keyLayoutTypes, reference.boxPresets));

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
  const keys = columns.value.map((column) => column.key);
  return matrix
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ""])));
}
async function applyPaste() {
  await commit(rowsFromMatrix(parseTsv(pasteText.value)));
  pasteOpen.value = false;
  pasteText.value = "";
}
async function uploadFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const workbook = XLSX.read(await file.arrayBuffer());
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
  await commit(rowsFromMatrix(matrix.slice(1)));
  (event.target as HTMLInputElement).value = "";
}
onMounted(load);
</script>

<template>
  <section class="page wide-page layer-master-page">
    <div class="page-title">
      <div><p class="eyebrow">PROJECT LAYER DATA</p><h1>Layer 정보</h1><p>{{ project.currentProject?.name }} 프로젝트의 Layer 기준정보입니다. Editor에는 필요한 Layer만 직접 가져올 수 있습니다.</p></div>
      <span class="status-pill" :class="{ busy }">{{ !project.canEdit ? '보기 전용' : busy ? '처리 중…' : status }}</span>
    </div>
    <div class="layer-master-summary panel">
      <div><b>{{ reference.layerMasters.length }}</b><span>등록 Layer</span></div>
      <div><b>{{ reference.keyLayoutTypes.length }}</b><span>우선순위 기준</span></div>
      <div><b>{{ selected.length }}</b><span>선택 행</span></div>
      <div class="button-strip">
        <button class="primary" :disabled="busy || !project.canEdit" @click="grid?.addDraftRow()">새 Layer 정보</button>
        <button :disabled="selected.length < 2 || busy || !project.canEdit" @click="groupSelected">Group ({{ selected.length }})</button>
        <button class="danger" :disabled="!selected.length || busy || !project.canEdit" @click="removeSelected">선택 삭제</button>
        <button :disabled="busy || !project.canEdit" @click="upload?.click()">Excel Upload</button>
        <button :disabled="busy || !project.canEdit" @click="pasteOpen = true">Clipboard Paste</button>
      </div>
    </div>
    <div class="sheet-help">셀 선택 후 바로 입력 또는 Enter/F2로 편집 · Ctrl+C / Ctrl+V로 Excel 범위 복사·붙여넣기 · 행 번호를 클릭해 선택</div>
    <input ref="upload" hidden type="file" accept=".xlsx,.xls,.csv,.tsv" @change="uploadFile">
    <div class="panel data-panel">
      <SpreadsheetGrid
        ref="grid"
        :columns="columns"
        :rows="rows"
        :selected-rows="selected"
        :readonly="!project.canEdit"
        :auto-commit="true"
        empty-hint="새 Layer 정보를 추가하세요."
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
