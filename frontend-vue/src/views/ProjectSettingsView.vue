<script setup lang="ts">
import { onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";
import type { ProjectAccessRequest, ProjectMember, ProjectRole } from "../types";

const router = useRouter();
const app = useAppStore();
const project = useProjectStore();
const name = ref("");
const description = ref("");
const approvalRoles = reactive<Record<string, "admin" | "editor" | "viewer">>({});
const memberQuery = ref("");
const newMemberRole = ref<"admin" | "editor" | "viewer">("viewer");

function syncForm() {
  name.value = project.currentProject?.name ?? "";
  description.value = project.currentProject?.description ?? "";
}
function memberActorId(member: ProjectMember) { return member.actor?.id ?? member.actor_id ?? member.id ?? "" }
function memberName(member: ProjectMember) { return member.actor?.display_name ?? member.display_name ?? "사내 사용자" }
function requestName(request: ProjectAccessRequest) { return request.requester?.display_name ?? request.actor?.display_name ?? request.display_name ?? "사내 사용자" }

async function saveGeneral() {
  if (!project.canAdminProject || !project.currentProject || !name.value.trim()) return;
  try { await project.updateProject(project.currentProject.id, { name: name.value.trim(), description: description.value.trim() || null }) }
  catch (error) { app.status = error instanceof Error ? error.message : String(error) }
}

async function review(request: ProjectAccessRequest, status: "approved" | "rejected") {
  await project.reviewAccessRequest(request.id, status, approvalRoles[request.id] ?? request.requested_role ?? "viewer");
}

async function changeRole(member: ProjectMember, role: ProjectRole) {
  const actorId = memberActorId(member);
  if (!actorId || member.role === "owner" || role === "owner") return;
  await project.updateMemberRole(actorId, role);
}

async function findUsers() {
  try { await project.searchUsers(memberQuery.value) }
  catch (error) { app.status = error instanceof Error ? error.message : String(error) }
}

async function addMember(actorId: string) {
  await project.addMember(actorId, newMemberRole.value);
  project.userCandidates = project.userCandidates.filter((row) => row.id !== actorId);
}

async function remove(member: ProjectMember) {
  const actorId = memberActorId(member);
  if (!actorId || member.role === "owner" || !confirm(`${memberName(member)} 사용자를 프로젝트에서 제거할까요?`)) return;
  await project.removeMember(actorId);
}

async function deleteProject() {
  const row = project.currentProject;
  if (!row || project.currentRole !== "owner" || !confirm(`“${row.name}” 프로젝트와 모든 Align Tree를 삭제할까요?`)) return;
  await project.deleteProject(row.id);
  await router.push("/");
}

watch(() => project.currentProject, syncForm, { immediate: true });
onMounted(async () => {
  await project.loadMembersAndRequests();
  for (const request of project.accessRequests) approvalRoles[request.id] = request.requested_role ?? "viewer";
});
</script>

<template>
  <section class="page project-settings-page">
    <div class="page-title"><div><p class="eyebrow">PROJECT SETTINGS</p><h1>Settings</h1><p>프로젝트 정보, 멤버와 사용 신청을 관리합니다.</p></div></div>
    <div class="settings-grid">
      <section v-if="project.canAdminProject" class="panel settings-section general-settings"><div class="panel-heading"><div><h2>General</h2><small>공개 게시판에 표시되는 정보</small></div></div><label>프로젝트 이름<input v-model="name" :disabled="!project.canEdit"></label><label>소개<textarea v-model="description" :disabled="!project.canEdit"></textarea></label><div class="settings-actions"><button class="primary" :disabled="!name.trim() || !project.canEdit" @click="saveGeneral">변경사항 적용</button></div></section>

      <section class="panel settings-section request-settings"><div class="panel-heading"><div><h2>Access Requests</h2><small>승인 대기 {{ project.accessRequests.filter(row => row.status === 'pending').length }}건</small></div><button @click="project.loadMembersAndRequests">새로고침</button></div><p v-if="!project.accessRequests.filter(row => row.status === 'pending').length" class="empty">대기 중인 사용 신청이 없습니다.</p><article v-for="request in project.accessRequests.filter(row => row.status === 'pending')" :key="request.id" class="access-request-row"><div><strong>{{ requestName(request) }}</strong><span>{{ request.message || '신청 메시지 없음' }}</span><small>{{ new Date(request.requested_at || request.created_at || '').toLocaleString() }} · 요청 {{ request.requested_role === 'editor' ? '편집' : '보기' }}</small></div><select v-model="approvalRoles[request.id]"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option></select><button class="primary subtle" @click="review(request, 'approved')">승인</button><button class="danger" @click="review(request, 'rejected')">거절</button></article></section>

      <section class="panel settings-section member-settings"><div class="panel-heading"><div><h2>Members</h2><small>{{ project.members.length }}명</small></div></div><div class="member-search"><div><input v-model="memberQuery" placeholder="표시 이름으로 사용자 검색" @keydown.enter="findUsers"><button :disabled="memberQuery.trim().length < 2" @click="findUsers">검색</button><select v-model="newMemberRole"><option value="viewer">Viewer로 추가</option><option value="editor">Editor로 추가</option><option value="admin">Admin으로 추가</option></select></div><div v-if="project.userCandidates.length" class="user-candidates"><button v-for="candidate in project.userCandidates" :key="candidate.id" @click="addMember(candidate.id)"><span><strong>{{ candidate.display_name }}</strong><small>{{ candidate.id }}</small></span><b>추가</b></button></div></div><p v-if="!project.members.length" class="empty">등록된 멤버가 없습니다.</p><article v-for="member in project.members" :key="memberActorId(member)" class="member-row"><div class="member-avatar">{{ memberName(member).slice(0, 1).toUpperCase() }}</div><div><strong>{{ memberName(member) }}</strong><small>{{ member.joined_at || member.created_at ? new Date(member.joined_at || member.created_at || '').toLocaleDateString() : '프로젝트 멤버' }}</small></div><select :value="member.role" :disabled="member.role === 'owner'" @change="changeRole(member, ($event.target as HTMLSelectElement).value as ProjectRole)"><option value="owner" disabled>Owner</option><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></select><button class="danger" :disabled="member.role === 'owner'" @click="remove(member)">제거</button></article></section>

      <section v-if="project.currentRole === 'owner'" class="panel settings-section danger-zone"><div><h2>Danger Zone</h2><p>프로젝트와 모든 Align Tree 데이터가 삭제됩니다.</p></div><button class="danger" :disabled="!project.canEdit" @click="deleteProject">프로젝트 삭제</button></section>
    </div>
  </section>
</template>
