<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ExternalLink, Pencil, Search, ShieldCheck, Trash2 } from "@lucide/vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";
import type { SystemAdminProject } from "../types";

const router = useRouter();
const app = useAppStore();
const projectStore = useProjectStore();
const projects = ref<SystemAdminProject[]>([]);
const loading = ref(true);
const error = ref("");
const query = ref("");
const includeDeleted = ref(false);
const editing = ref<SystemAdminProject | null>(null);
const editName = ref("");
const editDescription = ref("");
const deleting = ref<SystemAdminProject | null>(null);
const deleteConfirmName = ref("");

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return projects.value;
  return projects.value.filter((row) => `${row.name} ${row.description ?? ""} ${row.owner?.display_name ?? ""}`.toLowerCase().includes(needle));
});
const publicCount = computed(() => projects.value.filter((row) => row.is_public && !row.deleted_at).length);
const privateCount = computed(() => projects.value.filter((row) => !row.is_public && !row.deleted_at).length);

async function load() {
  loading.value = true;
  error.value = "";
  try { projects.value = await api.listSystemAdminProjects(includeDeleted.value) }
  catch (loadError) { error.value = loadError instanceof Error ? loadError.message : String(loadError) }
  finally { loading.value = false }
}

function openEdit(row: SystemAdminProject) {
  editing.value = row;
  editName.value = row.name;
  editDescription.value = row.description ?? "";
}

async function saveEdit() {
  if (!editing.value || !editName.value.trim()) return;
  const updated = await app.run("프로젝트 정보 수정", () => api.updateSystemAdminProject(editing.value!.id, {
    name: editName.value.trim(),
    description: editDescription.value.trim() || null,
  }));
  projects.value = projects.value.map((row) => row.id === updated.id ? updated : row);
  editing.value = null;
}

async function togglePublic(row: SystemAdminProject) {
  const updated = await app.run(
    row.is_public ? "프로젝트 비공개 전환" : "프로젝트 공개 전환",
    () => api.updateSystemAdminProject(row.id, { is_public: !row.is_public }),
  );
  projects.value = projects.value.map((item) => item.id === updated.id ? updated : item);
}

async function confirmDelete() {
  if (!deleting.value || deleteConfirmName.value !== deleting.value.name) return;
  const target = deleting.value;
  await app.run("프로젝트 삭제", () => api.deleteSystemAdminProject(target.id));
  projects.value = projects.value.filter((row) => row.id !== target.id);
  deleting.value = null;
  deleteConfirmName.value = "";
}

watch(includeDeleted, () => void load());
onMounted(async () => {
  await projectStore.bootstrap();
  if (!projectStore.session?.is_system_admin) {
    await router.replace({ name: "home" });
    return;
  }
  await load();
});
</script>

<template>
  <section class="page system-admin-page">
    <div class="page-title system-admin-title">
      <div><p class="eyebrow">SYSTEM ADMINISTRATION</p><h1><ShieldCheck :size="28"/>최상위 관리자</h1><p>모든 프로젝트의 정보, 공개 범위와 삭제 상태를 통합 관리합니다.</p></div>
      <button @click="load">새로고침</button>
    </div>

    <div class="system-admin-summary">
      <article><span>전체 프로젝트</span><strong>{{ projects.filter(row => !row.deleted_at).length }}</strong></article>
      <article><span>Public</span><strong>{{ publicCount }}</strong></article>
      <article><span>Private</span><strong>{{ privateCount }}</strong></article>
    </div>

    <section class="panel system-admin-panel">
      <div class="system-admin-toolbar">
        <label class="system-admin-search"><Search :size="16"/><input v-model="query" placeholder="프로젝트, 설명, 소유자 검색"></label>
        <label class="system-admin-deleted"><input v-model="includeDeleted" type="checkbox">삭제된 프로젝트 포함</label>
      </div>
      <div v-if="loading" class="data-loading">전체 프로젝트를 불러오는 중입니다.</div>
      <div v-else-if="error" class="data-error"><p>{{ error }}</p><button @click="load">다시 시도</button></div>
      <div v-else class="system-admin-table-wrap">
        <table class="system-admin-table">
          <thead><tr><th>프로젝트</th><th>소유자</th><th>공개 범위</th><th>멤버</th><th>Key Editor</th><th>최근 수정</th><th>관리</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id" :class="{ deleted: row.deleted_at }">
              <td><strong>{{ row.name }}</strong><small>{{ row.description || '설명 없음' }}</small></td>
              <td>{{ row.owner?.display_name || '소유자 미지정' }}</td>
              <td><button class="visibility-toggle" :class="row.is_public ? 'public' : 'private'" :disabled="Boolean(row.deleted_at)" @click="togglePublic(row)">{{ row.is_public ? 'Public' : 'Private' }}</button></td>
              <td>{{ row.member_count ?? 0 }}</td>
              <td>{{ row.align_tree_count ?? 0 }}</td>
              <td>{{ new Date(row.updated_at).toLocaleString() }}</td>
              <td class="system-admin-actions">
                <RouterLink v-if="!row.deleted_at" :to="{ name: 'project-home', params: { projectId: row.id } }" title="프로젝트 열기"><ExternalLink :size="16"/></RouterLink>
                <button v-if="!row.deleted_at" title="프로젝트 정보 수정" @click="openEdit(row)"><Pencil :size="16"/></button>
                <button v-if="!row.deleted_at" class="danger" title="프로젝트 삭제" @click="deleting = row; deleteConfirmName = ''"><Trash2 :size="16"/></button>
                <span v-else class="deleted-label">삭제됨</span>
              </td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="7" class="empty">조건에 맞는 프로젝트가 없습니다.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="editing" class="modal-backdrop" @click.self="editing = null">
      <section class="modal-card system-admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-edit-title">
        <p class="eyebrow">PROJECT MANAGEMENT</p><h2 id="admin-edit-title">프로젝트 정보 수정</h2>
        <label>프로젝트 이름<input v-model="editName" maxlength="160" autofocus></label>
        <label>설명<textarea v-model="editDescription" rows="5"></textarea></label>
        <div class="button-strip"><button @click="editing = null">취소</button><button class="primary" :disabled="!editName.trim()" @click="saveEdit">저장</button></div>
      </section>
    </div>

    <div v-if="deleting" class="modal-backdrop" @click.self="deleting = null">
      <section class="modal-card system-admin-modal danger-modal" role="alertdialog" aria-modal="true" aria-labelledby="admin-delete-title">
        <p class="eyebrow">DESTRUCTIVE ACTION</p><h2 id="admin-delete-title">프로젝트 삭제</h2>
        <p><b>{{ deleting.name }}</b>과 연결된 모든 Editor가 더 이상 표시되지 않습니다. 확인하려면 프로젝트 이름을 입력하세요.</p>
        <input v-model="deleteConfirmName" :placeholder="deleting.name" autofocus>
        <div class="button-strip"><button @click="deleting = null">취소</button><button class="danger" :disabled="deleteConfirmName !== deleting.name" @click="confirmDelete">프로젝트 삭제</button></div>
      </section>
    </div>
  </section>
</template>
