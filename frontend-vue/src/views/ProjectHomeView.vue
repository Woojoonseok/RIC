<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { auditActorName, auditEventChanges, auditEventTitle } from "../domain/audit";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";

const router = useRouter();
const app = useAppStore();
const project = useProjectStore();
const requestRole = ref<"viewer" | "editor">("viewer");
const requestMessage = ref("");
const requesting = ref(false);
const current = computed(() => project.currentProject);
const creator = computed(() => current.value?.creator_display_name ?? current.value?.creator?.display_name ?? "사내 사용자");

async function loadMemberHome() {
  if (!project.hasMembership) return;
  await Promise.all([project.loadAuditEvents(), project.loadAlignTrees()]);
}

async function requestAccess() {
  requesting.value = true;
  try { await project.requestAccess(requestRole.value, requestMessage.value); requestMessage.value = "" }
  catch (error) { app.status = error instanceof Error ? error.message : String(error) }
  finally { requesting.value = false }
}

async function claimLegacy() {
  if (!current.value?.is_legacy_unclaimed || !confirm("이 기존 프로젝트를 내 프로젝트로 가져올까요?")) return;
  await project.claimLegacyProject(current.value.id);
  await project.loadProject(current.value.id);
  await loadMemberHome();
}

watch(() => project.hasMembership, () => void loadMemberHome());
onMounted(loadMemberHome);
</script>

<template>
  <section v-if="current" class="page project-home-page">
    <div class="page-title"><div><p class="eyebrow">PROJECT HOME</p><h1>{{ current.name }}</h1><p>{{ current.description || '프로젝트 소개가 아직 없습니다.' }}</p></div><div class="project-owner-card"><span>생성자</span><strong>{{ creator }}</strong><small>업데이트 {{ new Date(current.updated_at).toLocaleString() }}</small></div></div>

    <template v-if="project.hasMembership">
      <div class="project-home-summary">
        <RouterLink class="panel project-summary-card" :to="{ name: 'align-tree-list', params: { projectId: current.id } }"><span>KEY EDITORS</span><strong>2</strong><small>Overlay Key · Align Key →</small></RouterLink>
        <div class="panel project-summary-card"><span>MEMBERS</span><strong>{{ current.member_count ?? 1 }}</strong><small>내 권한 · {{ project.currentRole }}</small></div>
        <div class="panel project-summary-card"><span>AUTO SAVE</span><strong class="summary-save-state">{{ project.autosaveLabel }}</strong><small>별도 저장 버튼 없이 서버에 반영됩니다.</small></div>
      </div>
      <div class="project-home-grid">
        <section class="panel project-quick-start"><div class="panel-heading"><h2>프로젝트 작업</h2></div><RouterLink :to="{ name: 'project-reference', params: { projectId: current.id } }"><span>01</span><div><strong>기준정보</strong><small>프로젝트별 Box·Relation 기준 관리</small></div><b>→</b></RouterLink><RouterLink :to="{ name: 'project-layers', params: { projectId: current.id } }"><span>02</span><div><strong>Layer 정보</strong><small>공정 Layer 기준과 우선순위 관리</small></div><b>→</b></RouterLink><RouterLink :to="{ name: 'align-tree-list', params: { projectId: current.id } }"><span>03</span><div><strong>Key Editors</strong><small>Overlay Key와 Align Key 편집</small></div><b>→</b></RouterLink></section>
        <section class="panel project-history"><div class="panel-heading"><div><p class="eyebrow">HISTORY</p><h2>최근 변경</h2><small>접속·열기·닫기 기록은 제외합니다.</small></div><button @click="project.loadAuditEvents">새로고침</button></div><p v-if="!project.auditEvents.length" class="empty">아직 기록된 변경이 없습니다.</p><ol><li v-for="event in project.auditEvents" :key="event.id"><i/><div><strong>{{ auditEventTitle(event) }}</strong><small v-if="auditEventChanges(event).length">{{ auditEventChanges(event).join(' · ') }}</small><span>{{ auditActorName(event) }}<template v-if="event.align_tree_id"> · Align Tree</template></span></div><time>{{ new Date(event.created_at).toLocaleString() }}</time></li></ol></section>
      </div>
    </template>

    <section v-else class="panel access-gate">
      <div class="access-gate-icon">◇</div>
      <div v-if="current.is_legacy_unclaimed"><p class="eyebrow">LEGACY PROJECT</p><h2>소유자가 지정되지 않은 기존 프로젝트입니다.</h2><p>이 프로젝트의 담당자라면 가져온 뒤 멤버와 Align Tree를 관리할 수 있습니다.</p><button class="primary" @click="claimLegacy">기존 프로젝트 가져오기</button></div>
      <div v-else-if="project.accessRequestStatus === 'pending'"><p class="eyebrow">ACCESS REQUESTED</p><h2>사용 신청이 승인 대기 중입니다.</h2><p>프로젝트 owner 또는 admin이 승인하면 내부 메뉴가 열립니다.</p><button @click="router.push('/')">프로젝트 게시판으로</button></div>
      <div v-else><p class="eyebrow">MEMBERS ONLY</p><h2>이 프로젝트의 사용 권한을 신청하세요.</h2><p>Project Home의 공개 정보는 볼 수 있지만 기준정보, Layer 정보와 Align Tree는 멤버만 접근할 수 있습니다.</p><div class="access-request-form"><label>요청 권한<select v-model="requestRole"><option value="viewer">보기 권한</option><option value="editor">편집 권한</option></select></label><label>신청 메시지<textarea v-model="requestMessage" placeholder="참여 목적이나 담당 업무를 적어주세요."></textarea></label><button class="primary" :disabled="requesting" @click="requestAccess">{{ requesting ? '신청 중…' : '사용 신청' }}</button></div></div>
    </section>
  </section>
</template>
