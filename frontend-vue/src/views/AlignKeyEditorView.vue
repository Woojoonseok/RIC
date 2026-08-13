<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Download, Plus, Search, Trash2 } from "@lucide/vue";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";
import type { AlignKeyRow, AlignKeyRowUpdate } from "../types";

const app = useAppStore();
const project = useProjectStore();
const rows = ref<AlignKeyRow[]>([]);
const loading = ref(true);
const loadError = ref("");
const query = ref("");
const selected = ref<string[]>([]);
let saveQueue = Promise.resolve();

const filteredRows = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase("ko");
  return needle ? rows.value.filter((row) => Object.values(row).some((value) => String(value).toLocaleLowerCase("ko").includes(needle))) : rows.value;
});

async function load() {
  if (!project.currentProjectId) return;
  loading.value = true;
  loadError.value = "";
  try { rows.value = await api.alignKeyRows(project.currentProjectId) }
  catch (error) { loadError.value = error instanceof Error ? error.message : "Align Key 데이터를 불러오지 못했습니다." }
  finally { loading.value = false }
}

async function addRow() {
  const saved = await app.run("Align Key 행 추가", () => api.createAlignKeyRow(project.currentProjectId, {
    key_name: "", key_type: "", layer: "", comment: "", sort_order: rows.value.length,
  }));
  rows.value.push(saved);
}

function updateRow(row: AlignKeyRow, body: AlignKeyRowUpdate) {
  Object.assign(row, body);
  project.markSaving();
  saveQueue = saveQueue.then(async () => {
    try {
      const saved = await api.updateAlignKeyRow(project.currentProjectId, row.id, body);
      Object.assign(row, saved);
      project.markSaved();
    } catch (error) { project.markSaveError(error) }
  });
}

async function removeSelected() {
  const ids = [...selected.value];
  if (!ids.length || !window.confirm(`${ids.length}개 행을 삭제할까요?`)) return;
  await app.run("Align Key 행 삭제", () => Promise.all(ids.map((id) => api.deleteAlignKeyRow(project.currentProjectId, id))));
  rows.value = rows.value.filter((row) => !ids.includes(row.id));
  selected.value = [];
}

function toggleSelected(id: string) {
  selected.value = selected.value.includes(id) ? selected.value.filter((item) => item !== id) : [...selected.value, id];
}

function pasteRows(event: ClipboardEvent) {
  if (!project.canEdit || !event.clipboardData) return;
  const lines = event.clipboardData.getData("text/plain").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2 || !lines.some((line) => line.includes("\t"))) return;
  event.preventDefault();
  void Promise.all(lines.map((line, index) => {
    const [key_name = "", key_type = "", layer = "", comment = ""] = line.split("\t");
    return api.createAlignKeyRow(project.currentProjectId, { key_name, key_type, layer, comment, sort_order: rows.value.length + index });
  })).then((created) => rows.value.push(...created));
}

function exportCsv() {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csv = ["Key Name,Key Type,Layer,Comment", ...rows.value.map((row) => [row.key_name, row.key_type, row.layer, row.comment].map(escape).join(","))].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  link.download = "align-key-table.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

watch(() => project.currentProjectId, () => void load());
onMounted(load);
</script>

<template>
  <section class="page wide-page align-key-editor-page" @paste="pasteRows">
    <div class="page-title">
      <div><p class="eyebrow">ALIGN KEY EDITOR</p><h1>Align Key Table</h1><p>프로젝트의 Align Key 데이터를 자동 저장합니다.</p></div>
      <div class="align-key-actions">
        <button :disabled="!project.canEdit" @click="addRow"><Plus :size="16"/>행 추가</button>
        <button :disabled="!selected.length || !project.canEdit" @click="removeSelected"><Trash2 :size="16"/>선택 삭제</button>
        <button @click="exportCsv"><Download :size="16"/>CSV</button>
      </div>
    </div>
    <label class="align-key-search"><Search :size="16"/><input v-model="query" placeholder="Key Name, Type, Layer, Comment 검색"></label>
    <p class="sheet-help">셀을 수정하면 자동 저장됩니다 · Excel의 4열 범위를 붙여넣어 행을 추가할 수 있습니다.</p>
    <div v-if="loading" class="panel data-loading">Align Key 데이터를 불러오는 중입니다.</div>
    <div v-else-if="loadError" class="panel data-error"><p>{{ loadError }}</p><button @click="load">다시 시도</button></div>
    <div v-else class="final-table-shell">
      <div class="final-table-scroll">
        <table class="final-table align-key-table">
          <thead><tr class="final-table-main"><th><input type="checkbox" :checked="selected.length === rows.length && rows.length > 0" aria-label="전체 행 선택" @change="selected = ($event.target as HTMLInputElement).checked ? rows.map((row) => row.id) : []"></th><th>No.</th><th>Key Name</th><th>Key Type</th><th>Layer</th><th>Comment</th></tr></thead>
          <tbody>
            <tr v-for="(row, index) in filteredRows" :key="row.id">
              <td><input type="checkbox" :checked="selected.includes(row.id)" :aria-label="`${index + 1}행 선택`" @change="toggleSelected(row.id)"></td>
              <th class="number-cell">{{ index + 1 }}</th>
              <td><input :value="row.key_name" :disabled="!project.canEdit" :aria-label="`${index + 1}행 Key Name`" @change="updateRow(row, { key_name: ($event.target as HTMLInputElement).value })"></td>
              <td><input :value="row.key_type" :disabled="!project.canEdit" :aria-label="`${index + 1}행 Key Type`" @change="updateRow(row, { key_type: ($event.target as HTMLInputElement).value })"></td>
              <td><input :value="row.layer" :disabled="!project.canEdit" :aria-label="`${index + 1}행 Layer`" @change="updateRow(row, { layer: ($event.target as HTMLInputElement).value })"></td>
              <td><input :value="row.comment" :disabled="!project.canEdit" :aria-label="`${index + 1}행 Comment`" @change="updateRow(row, { comment: ($event.target as HTMLInputElement).value })"></td>
            </tr>
            <tr v-if="!filteredRows.length"><td colspan="6" class="final-table-empty">{{ query ? '검색 결과가 없습니다.' : '행 추가를 눌러 Align Key를 등록하세요.' }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
