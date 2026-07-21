<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";
import type { Project } from "../types";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const project = useProjectStore();
const query = ref("");
const filter = ref<"all" | "mine" | "pending">("all");
const createOpen = ref(route.query.create === "1");
const name = ref("");
const description = ref("");
const displayName = ref("");

const rows = computed(() => project.publicProjects.filter((row) => {
  const matches = `${row.name} ${row.description ?? ""} ${creatorName(row)}`.toLowerCase().includes(query.value.trim().toLowerCase());
  if (!matches) return false;
  if (filter.value === "mine") return Boolean(row.my_role ?? row.membership_role ?? row.access_role);
  if (filter.value === "pending") return row.access_request_status === "pending";
  return true;
}));

function creatorName(row: Project) { return row.creator_display_name ?? row.creator?.display_name ?? "사내 사용자" }
function role(row: Project) { return row.my_role ?? row.membership_role ?? row.access_role ?? null }
function accessLabel(row: Project) {
  if (row.is_legacy_unclaimed) return "소유자 미지정";
  if (role(row)) return role(row) === "owner" ? "내 프로젝트" : `${role(row)} 멤버`;
  if (row.access_request_status === "pending") return "승인 대기";
  return "공개 게시물";
}

async function createProject() {
  if (!name.value.trim()) return;
  const created = await project.createProject({ name: name.value.trim(), description: description.value.trim() || null });
  name.value = ""; description.value = ""; createOpen.value = false;
  await router.push({ name: "project-home", params: { projectId: created.id } });
}

async function claimLegacy(row: Project) {
  if (!row.is_legacy_unclaimed || !confirm(`기존 프로젝트 “${row.name}”을 내 프로젝트로 가져올까요?`)) return;
  const claimed = await project.claimLegacyProject(row.id);
  await router.push({ name: "project-home", params: { projectId: claimed.id } });
}

async function saveDisplayName() {
  if (!displayName.value.trim() || displayName.value.trim() === project.session?.display_name) return;
  try { await project.updateDisplayName(displayName.value) }
  catch (error) { app.status = error instanceof Error ? error.message : String(error) }
}

watch(() => route.query.create, (value) => { if (value === "1") createOpen.value = true });
watch(() => project.session?.display_name, (value) => { if (value) displayName.value = value }, { immediate: true });
onMounted(() => void project.bootstrap());
</script>

<template>
  <section class="page project-board-page">
    <div class="page-title board-title"><div><p class="eyebrow">PUBLIC PROJECT BOARD</p><h1>사내 프로젝트</h1><p>공개된 프로젝트를 살펴보고, 참여하거나 새 프로젝트를 시작하세요.</p></div><button class="primary" @click="createOpen = !createOpen">{{ createOpen ? '닫기' : '프로젝트 만들기' }}</button></div>

    <section v-if="createOpen" class="panel board-create-panel">
      <div><p class="eyebrow">NEW PROJECT</p><h2>프로젝트 게시물 만들기</h2><p>프로젝트 내부 데이터는 멤버에게만 공개됩니다.</p></div>
      <label>프로젝트 이름<input v-model="name" autofocus placeholder="예: Next Process Align"></label>
      <label>소개<textarea v-model="description" placeholder="목적과 참여 대상을 간단히 적어주세요."></textarea></label>
      <div class="button-strip"><button @click="createOpen = false">취소</button><button class="primary" :disabled="!name.trim()" @click="createProject">생성</button></div>
    </section>

    <section class="board-toolbar">
      <div class="board-search"><input v-model="query" placeholder="프로젝트, 설명, 생성자 검색"><div class="filter-chips"><button v-for="item in (['all','mine','pending'] as const)" :key="item" :class="{ active: filter === item }" @click="filter = item">{{ item === 'all' ? '전체' : item === 'mine' ? '내 프로젝트' : '승인 대기' }}</button></div></div>
      <div class="identity-editor"><span>게시판 표시 이름</span><input v-model="displayName" placeholder="표시 이름"><button :disabled="!displayName.trim() || displayName.trim() === project.session?.display_name" @click="saveDisplayName">변경</button></div>
    </section>

    <div class="project-board-grid">
      <article v-for="row in rows" :key="row.id" class="panel project-post-card">
        <div class="project-post-meta"><span class="access-badge" :class="role(row) || (row.access_request_status === 'pending' ? 'pending' : 'public')">{{ accessLabel(row) }}</span><small>{{ new Date(row.updated_at).toLocaleDateString() }}</small></div>
        <RouterLink :to="{ name: 'project-home', params: { projectId: row.id } }" class="project-post-link"><h2>{{ row.name }}</h2><p>{{ row.description || '프로젝트 소개가 아직 없습니다.' }}</p></RouterLink>
        <div class="project-post-stats"><span>생성자 <b>{{ creatorName(row) }}</b></span><span>멤버 <b>{{ row.member_count ?? 0 }}</b></span><span>Align Tree <b>{{ row.align_tree_count ?? 0 }}</b></span></div>
        <button v-if="row.is_legacy_unclaimed" class="primary subtle legacy-claim" @click="claimLegacy(row)">기존 프로젝트 가져오기</button>
      </article>
      <div v-if="!rows.length" class="panel board-empty"><strong>조건에 맞는 프로젝트가 없습니다.</strong><p>새 프로젝트 게시물을 만들어 작업을 시작해 보세요.</p></div>
    </div>
  </section>
</template>
