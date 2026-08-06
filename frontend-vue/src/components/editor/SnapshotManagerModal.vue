<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AlertTriangle, CheckCircle2, GitCompareArrows, History, Plus, RotateCcw, Trash2, X } from "@lucide/vue";
import { api } from "../../api/client";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";
import { useProjectStore } from "../../stores/project";
import type { SnapshotDiff, SnapshotDiffSection, SnapshotSummary } from "../../types";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const snapshots = ref<SnapshotSummary[]>([]);
const selectedId = ref("");
const targetId = ref("");
const name = ref("");
const description = ref("");
const comparison = ref<SnapshotDiff | null>(null);
const restorePreview = ref<SnapshotDiff | null>(null);
const busy = ref(false);
const error = ref("");
let compareNonce = 0;

const selected = computed(() => snapshots.value.find((snapshot) => snapshot.id === selectedId.value) ?? null);
const targetSnapshots = computed(() => snapshots.value.filter((snapshot) => snapshot.id !== selectedId.value));
const diffSections = computed(() => comparison.value ? [
  { key: "layers", label: "Layer", value: comparison.value.layers },
  { key: "relations", label: "Relation", value: comparison.value.relations },
  { key: "text_boxes", label: "도형·텍스트", value: comparison.value.text_boxes },
] : []);
const restoreSections = computed(() => restorePreview.value ? [
  { label: "Layer", value: restorePreview.value.layers },
  { label: "Relation", value: restorePreview.value.relations },
  { label: "도형·텍스트", value: restorePreview.value.text_boxes },
] : []);

function changeCount(section: SnapshotDiffSection) {
  return section.added + section.removed + section.modified;
}
function formatDate(value: string) {
  return new Date(value).toLocaleString("ko-KR");
}
function treeFieldLabel(field: string) {
  return ({
    process_name: "Process",
    gds_name: "GDS",
    layer_process_names: "Layer Process",
    layer_gds_names: "Layer GDS",
    final_table_cells: "Final Table",
  } as Record<string, string>)[field] ?? field;
}
async function load() {
  if (!project.projectId) return;
  busy.value = true;
  error.value = "";
  try {
    snapshots.value = await api.listSnapshots(project.projectId);
    if (!snapshots.value.some((snapshot) => snapshot.id === selectedId.value)) {
      selectedId.value = snapshots.value[0]?.id ?? "";
    }
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : String(loadError);
  } finally {
    busy.value = false;
  }
}
async function compare() {
  if (!selectedId.value) {
    comparison.value = null;
    return;
  }
  const nonce = ++compareNonce;
  restorePreview.value = null;
  error.value = "";
  try {
    const result = await api.compareSnapshot(project.projectId, selectedId.value, targetId.value || undefined);
    if (nonce === compareNonce) comparison.value = result;
  } catch (compareError) {
    if (nonce === compareNonce) error.value = compareError instanceof Error ? compareError.message : String(compareError);
  }
}
async function createSnapshot() {
  const label = name.value.trim();
  if (!label || !project.canEdit) return;
  busy.value = true;
  error.value = "";
  project.markSaving();
  try {
    const created = await api.createSnapshot(project.projectId, { name: label, description: description.value.trim() || null });
    snapshots.value = [created, ...snapshots.value];
    selectedId.value = created.id;
    targetId.value = "";
    name.value = "";
    description.value = "";
    project.markSaved();
    app.status = `스냅샷 '${created.name}' 저장 완료`;
  } catch (createError) {
    project.handleMutationError(createError);
    error.value = createError instanceof Error ? createError.message : String(createError);
  } finally {
    busy.value = false;
  }
}
async function removeSnapshot(snapshot: SnapshotSummary) {
  if (!project.canEdit || !confirm(`스냅샷 '${snapshot.name}'을 삭제할까요?`)) return;
  busy.value = true;
  project.markSaving();
  try {
    await api.deleteSnapshot(project.projectId, snapshot.id);
    snapshots.value = snapshots.value.filter((row) => row.id !== snapshot.id);
    selectedId.value = snapshots.value[0]?.id ?? "";
    project.markSaved();
    app.status = "스냅샷 삭제 완료";
  } catch (removeError) {
    project.handleMutationError(removeError);
    error.value = removeError instanceof Error ? removeError.message : String(removeError);
  } finally {
    busy.value = false;
  }
}
async function previewRestore() {
  if (!selected.value || !project.canEdit) return;
  busy.value = true;
  error.value = "";
  try {
    restorePreview.value = await api.previewSnapshotRestore(project.projectId, selected.value.id);
  } catch (previewError) {
    project.handleMutationError(previewError);
    error.value = previewError instanceof Error ? previewError.message : String(previewError);
  } finally {
    busy.value = false;
  }
}
async function restore() {
  if (!selected.value || !restorePreview.value || !project.canEdit) return;
  if (!confirm(`현재 Editor를 스냅샷 '${selected.value.name}' 상태로 복원할까요?`)) return;
  busy.value = true;
  project.markSaving();
  try {
    graph.setGraph(await api.restoreSnapshot(project.projectId, selected.value.id));
    project.markSaved();
    app.clearSelection();
    app.status = `스냅샷 '${selected.value.name}' 복원 완료`;
    emit("close");
  } catch (restoreError) {
    project.handleMutationError(restoreError);
    error.value = restoreError instanceof Error ? restoreError.message : String(restoreError);
  } finally {
    busy.value = false;
  }
}

watch(() => props.open, (open) => {
  if (open) void load();
  else {
    comparison.value = null;
    restorePreview.value = null;
    error.value = "";
  }
}, { immediate: true });
watch([selectedId, targetId], () => {
  if (targetId.value === selectedId.value) targetId.value = "";
  void compare();
});
</script>

<template>
  <div v-if="open" class="paste-overlay snapshot-overlay" @click="emit('close')">
    <section class="panel snapshot-panel" aria-label="Editor 스냅샷" @click.stop>
      <header class="snapshot-heading">
        <div><p class="eyebrow">VERSION HISTORY</p><h2>Editor 스냅샷</h2><span>저장된 상태를 비교하고 필요한 시점으로 복원합니다.</span></div>
        <button type="button" title="닫기" aria-label="스냅샷 닫기" @click="emit('close')"><X :size="18"/></button>
      </header>

      <form v-if="project.canEdit" class="snapshot-create" @submit.prevent="createSnapshot">
        <label><span>스냅샷 이름</span><input v-model="name" maxlength="160" placeholder="예: 검토 완료본"></label>
        <label><span>설명</span><input v-model="description" maxlength="1000" placeholder="변경 목적 또는 확인 사항"></label>
        <button class="primary" type="submit" :disabled="busy || !name.trim()"><Plus :size="16"/>현재 상태 저장</button>
      </form>

      <p v-if="error" class="snapshot-error">{{ error }}</p>
      <div class="snapshot-workspace">
        <aside class="snapshot-list" aria-label="저장된 스냅샷 목록">
          <div class="snapshot-list-heading"><strong>저장본</strong><span>{{ snapshots.length }}</span></div>
          <p v-if="!busy && !snapshots.length">저장된 스냅샷이 없습니다.</p>
          <button
            v-for="snapshot in snapshots"
            :key="snapshot.id"
            type="button"
            :class="{ active: snapshot.id === selectedId }"
            @click="selectedId = snapshot.id"
          >
            <strong>{{ snapshot.name }}</strong>
            <span>{{ formatDate(snapshot.created_at) }}</span>
            <small>Layer {{ snapshot.summary.layers ?? 0 }} · Relation {{ snapshot.summary.relations ?? 0 }} · {{ snapshot.created_by_label }}</small>
          </button>
        </aside>

        <section v-if="selected" class="snapshot-detail">
          <div class="snapshot-detail-heading">
            <div><h3>{{ selected.name }}</h3><p>{{ selected.description || "설명 없음" }}</p></div>
            <button v-if="project.canEdit" type="button" class="danger ghost" title="스냅샷 삭제" @click="removeSnapshot(selected)"><Trash2 :size="16"/>삭제</button>
          </div>

          <div class="snapshot-compare-toolbar">
            <GitCompareArrows :size="17"/>
            <span>비교 대상</span>
            <select v-model="targetId">
              <option value="">현재 상태</option>
              <option v-for="snapshot in targetSnapshots" :key="snapshot.id" :value="snapshot.id">{{ snapshot.name }}</option>
            </select>
          </div>

          <section v-if="comparison" class="snapshot-comparison">
            <div class="snapshot-version-line"><strong>{{ comparison.base.name }}</strong><span>→</span><strong>{{ comparison.target.name }}</strong></div>
            <div v-if="comparison.has_changes" class="snapshot-diff-grid">
              <div v-for="section in diffSections" :key="section.key">
                <strong>{{ section.label }}</strong>
                <span class="added">추가 {{ section.value.added }}</span>
                <span class="removed">삭제 {{ section.value.removed }}</span>
                <span>수정 {{ section.value.modified }}</span>
              </div>
            </div>
            <div v-else class="snapshot-no-change"><CheckCircle2 :size="18"/><span>두 상태가 같습니다.</span></div>

            <div v-if="comparison.tree_fields.length" class="snapshot-tree-fields">
              <strong>Editor 기준 변경</strong><span v-for="field in comparison.tree_fields" :key="field">{{ treeFieldLabel(field) }}</span>
            </div>
            <details v-for="section in diffSections.filter((row) => changeCount(row.value))" :key="`items-${section.key}`" class="snapshot-items">
              <summary>{{ section.label }} 변경 항목 {{ changeCount(section.value) }}개</summary>
              <div><span v-for="item in section.value.added_items" :key="`a-${item.id}`" class="added">+ {{ item.label }}</span><span v-for="item in section.value.removed_items" :key="`r-${item.id}`" class="removed">- {{ item.label }}</span><span v-for="item in section.value.modified_items" :key="`m-${item.id}`">수정 {{ item.label }}</span></div>
            </details>
          </section>

          <div v-if="project.canEdit" class="snapshot-restore-actions">
            <button v-if="!restorePreview" type="button" :disabled="busy" @click="previewRestore"><History :size="16"/>복원 영향 확인</button>
            <template v-else>
              <section class="snapshot-restore-preview">
                <div><RotateCcw :size="18"/><strong>복원 후 변경</strong></div>
                <p v-for="section in restoreSections" :key="section.label"><span>{{ section.label }}</span><b>추가 {{ section.value.added }}</b><b>삭제 {{ section.value.removed }}</b><b>수정 {{ section.value.modified }}</b></p>
                <p v-if="restorePreview.tree_fields.length"><span>Editor 기준</span><b>{{ restorePreview.tree_fields.length }}개 변경</b></p>
                <div v-for="warning in restorePreview.warnings" :key="warning" class="snapshot-warning"><AlertTriangle :size="16"/><span>{{ warning }}</span></div>
              </section>
              <button type="button" @click="restorePreview = null">취소</button>
              <button type="button" class="primary" :disabled="busy" @click="restore"><RotateCcw :size="16"/>이 상태로 복원</button>
            </template>
          </div>
        </section>
        <div v-else class="snapshot-empty"><History :size="28"/><span>비교할 스냅샷을 선택하세요.</span></div>
      </div>
    </section>
  </div>
</template>
