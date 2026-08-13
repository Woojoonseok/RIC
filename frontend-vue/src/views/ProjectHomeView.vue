<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { BookOpen, History, KeyRound, Layers, RefreshCw, UserRound, UsersRound } from "@lucide/vue";
import { useRouter } from "vue-router";
import { auditActorName, auditEventChanges, auditEventTitle } from "../domain/audit";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";
import type { ProjectMember, ProjectRole } from "../types";

const router = useRouter();
const app = useAppStore();
const project = useProjectStore();
const requestRole = ref<"viewer" | "editor">("viewer");
const requestMessage = ref("");
const requesting = ref(false);
const refreshing = ref(false);
const claiming = ref(false);
const claimError = ref("");
const showLayoutHistory = ref(false);
const current = computed(() => project.currentProject);
const creator = computed(() => current.value?.creator_display_name ?? current.value?.creator?.display_name ?? "사내 사용자");
const editingActorId = computed(() => current.value?.lock_holder_actor_id ?? null);
const activeEditorName = computed(() => current.value?.lock_holder_display_name ?? "편집 중인 사용자 없음");
const roleOrder: ProjectRole[] = ["owner", "admin", "editor", "viewer"];
const roleLabels: Record<ProjectRole, string> = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" };
const visibleAuditEvents = computed(() => project.auditEvents.filter((event) => (
  showLayoutHistory.value || !event.event_type?.includes("layout")
)).slice(0, 30));
let refreshTimer: number | null = null;

const membersByRole = computed(() => Object.fromEntries(roleOrder.map((role) => [
  role,
  project.members.filter((member) => member.role === role),
])) as Record<ProjectRole, ProjectMember[]>);

function memberId(member: ProjectMember) {
  return member.actor?.id ?? member.actor_id ?? member.id;
}

function memberName(member: ProjectMember) {
  return member.actor?.display_name ?? member.display_name ?? "이름 없음";
}

async function refreshDashboard(includeHistory = false) {
  if (!project.hasMembership || refreshing.value) return;
  refreshing.value = true;
  try {
    const tasks: Promise<unknown>[] = [project.refreshCurrentProject(), project.loadMembers()];
    if (includeHistory) tasks.push(project.loadAuditEvents(), project.loadAlignTrees());
    await Promise.all(tasks);
  } catch (error) {
    app.status = error instanceof Error ? error.message : String(error);
  } finally {
    refreshing.value = false;
  }
}

async function loadMemberHome() {
  if (!project.hasMembership) return;
  await refreshDashboard(true);
}

async function requestAccess() {
  requesting.value = true;
  try { await project.requestAccess(requestRole.value, requestMessage.value); requestMessage.value = "" }
  catch (error) { app.status = error instanceof Error ? error.message : String(error) }
  finally { requesting.value = false }
}

async function claimLegacy() {
  if (!current.value?.is_legacy_unclaimed || !confirm("이 기존 프로젝트를 내 프로젝트로 가져올까요?")) return;
  const projectId = current.value.id;
  claiming.value = true;
  claimError.value = "";
  try {
    await project.claimLegacyProject(projectId);
    await project.loadProject(projectId);
    await loadMemberHome();
  } catch (error) {
    claimError.value = error instanceof Error ? error.message : String(error);
  } finally {
    claiming.value = false;
  }
}

watch(() => project.hasMembership, () => void loadMemberHome());
onMounted(() => {
  void loadMemberHome();
  refreshTimer = window.setInterval(() => void refreshDashboard(), 15_000);
});
onBeforeUnmount(() => {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
});
</script>

<template>
  <section v-if="current" class="page project-home-page">
    <div class="page-title project-dashboard-title">
      <div><p class="eyebrow">PROJECT DASHBOARD</p><h1>{{ current.name }}</h1><p>{{ current.description || '프로젝트 소개가 아직 없습니다.' }}</p></div>
      <div class="project-owner-card"><span>프로젝트 Owner</span><strong>{{ creator }}</strong><small>업데이트 {{ new Date(current.updated_at).toLocaleString() }}</small></div>
    </div>

    <template v-if="project.hasMembership">
      <div class="project-home-summary">
        <RouterLink class="panel project-summary-card" :to="{ name: 'align-tree-list', params: { projectId: current.id } }"><span>KEY EDITORS</span><strong>2</strong><small>Overlay Key · Align Key</small></RouterLink>
        <div class="panel project-summary-card"><span>PROJECT MEMBERS</span><strong>{{ project.members.length || current.member_count || 1 }}</strong><small>내 권한 · {{ roleLabels[project.currentRole!] }}</small></div>
        <div class="panel project-summary-card project-editor-status" :class="{ active: current.is_locked }"><span>CURRENT EDITOR</span><strong>{{ activeEditorName }}</strong><small>{{ current.is_locked ? (current.locked_by_me ? '내가 편집 중입니다.' : '프로젝트 편집 세션이 활성 상태입니다.') : '현재 다른 편집 세션이 없습니다.' }}</small></div>
      </div>

      <nav class="project-dashboard-links" aria-label="프로젝트 작업 바로가기">
        <RouterLink :to="{ name: 'project-reference', params: { projectId: current.id } }"><BookOpen :size="17"/><span><strong>기준정보</strong><small>Box·Relation 기준 관리</small></span></RouterLink>
        <RouterLink :to="{ name: 'project-layers', params: { projectId: current.id } }"><Layers :size="17"/><span><strong>Layer 정보</strong><small>공정 Layer와 우선순위 관리</small></span></RouterLink>
        <RouterLink :to="{ name: 'align-tree-list', params: { projectId: current.id } }"><KeyRound :size="17"/><span><strong>Key Editors</strong><small>Overlay Key·Align Key 편집</small></span></RouterLink>
      </nav>

      <div class="project-home-grid">
        <section class="panel project-team">
          <div class="panel-heading"><div><UsersRound :size="18"/><div><h2>프로젝트 멤버</h2><small>권한과 현재 편집 상태</small></div></div><button class="icon-button" title="멤버 및 편집 상태 새로고침" :disabled="refreshing" @click="refreshDashboard()"><RefreshCw :size="16"/></button></div>
          <div class="project-role-summary">
            <div v-for="role in roleOrder" :key="role"><span>{{ roleLabels[role] }}</span><strong>{{ membersByRole[role].length }}</strong></div>
          </div>
          <div class="project-member-list">
            <article v-for="member in project.members" :key="memberId(member)" :class="{ editing: memberId(member) === editingActorId }">
              <div class="project-member-avatar">{{ memberName(member).slice(0, 1).toUpperCase() }}</div>
              <div><strong>{{ memberName(member) }}</strong><small>{{ member.created_at ? new Date(member.created_at).toLocaleDateString() : '프로젝트 멤버' }}</small></div>
              <span class="project-role-badge" :class="member.role">{{ roleLabels[member.role] }}</span>
              <b v-if="memberId(member) === editingActorId" class="editing-badge"><i/>편집 중</b>
            </article>
            <p v-if="!project.members.length" class="empty">멤버 정보를 불러오는 중입니다.</p>
          </div>
        </section>

        <section class="panel project-history">
          <div class="panel-heading"><div><History :size="18"/><div><p class="eyebrow">HISTORY</p><h2>최근 변경</h2><small>접속 기록과 반복 위치 이동은 기본적으로 숨깁니다.</small></div></div><button class="icon-button" title="변경 이력 새로고침" @click="project.loadAuditEvents"><RefreshCw :size="16"/></button></div>
          <label class="history-layout-toggle"><input v-model="showLayoutHistory" type="checkbox">위치 이동 기록 포함</label>
          <p v-if="!visibleAuditEvents.length" class="empty">아직 기록된 변경이 없습니다.</p>
          <ol><li v-for="event in visibleAuditEvents" :key="event.id"><i/><div><strong>{{ auditEventTitle(event) }}</strong><small v-if="auditEventChanges(event).length">{{ auditEventChanges(event).join(' · ') }}</small><span>{{ auditActorName(event) }}<template v-if="event.align_tree_id"> · Align Tree</template></span></div><time>{{ new Date(event.created_at).toLocaleString() }}</time></li></ol>
        </section>
      </div>
    </template>

    <section v-else class="panel access-gate">
      <div class="access-gate-icon"><UserRound :size="36"/></div>
      <div v-if="current.is_legacy_unclaimed"><p class="eyebrow">LEGACY PROJECT</p><h2>소유자가 지정되지 않은 기존 프로젝트입니다.</h2><p>이 프로젝트의 담당자라면 가져온 뒤 멤버와 Align Tree를 관리할 수 있습니다.</p><button class="primary" :disabled="claiming" @click="claimLegacy">{{ claiming ? '가져오는 중...' : '기존 프로젝트 가져오기' }}</button><p v-if="claimError" class="legacy-claim-error" role="alert">{{ claimError }}</p></div>
      <div v-else-if="project.accessRequestStatus === 'pending'"><p class="eyebrow">ACCESS REQUESTED</p><h2>사용 신청이 승인 대기 중입니다.</h2><p>프로젝트 Owner 또는 Admin이 승인하면 내부 메뉴가 열립니다.</p><button @click="router.push('/')">프로젝트 게시판으로</button></div>
      <div v-else><p class="eyebrow">MEMBERS ONLY</p><h2>이 프로젝트의 사용 권한을 신청하세요.</h2><p>Project Dashboard의 공개 정보는 볼 수 있지만 기준정보, Layer 정보와 Key Editor는 멤버만 접근할 수 있습니다.</p><div class="access-request-form"><label>요청 권한<select v-model="requestRole"><option value="viewer">보기 권한</option><option value="editor">편집 권한</option></select></label><label>신청 메시지<textarea v-model="requestMessage" placeholder="참여 목적이나 담당 업무를 적어주세요."></textarea></label><button class="primary" :disabled="requesting" @click="requestAccess">{{ requesting ? '신청 중…' : '사용 신청' }}</button></div></div>
    </section>
  </section>
</template>
