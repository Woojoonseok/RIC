import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { ApiError, api, configureProjectRequestContext } from "../api/client";
import type {
  AccessRequestStatus, AlignTree, AlignTreeCreate, AnonymousSession, AuditEvent, EditLease, Project,
  ProjectAccessRequest, ProjectCreate, ProjectMember, ProjectRole, ProjectUpdate,
  UserSummary,
} from "../types";
import { useAppStore } from "./app";
import { isChangeAuditEvent } from "../domain/audit";

type LeaseState = "idle" | "acquiring" | "held" | "viewer" | "locked" | "lost";
export type AutosaveState = "idle" | "saving" | "saved" | "error" | "conflict";
const HEARTBEAT_MS = 25_000;

function newClientInstanceId(): string {
  const key = "ric-client-instance-id";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(key, created);
  return created;
}

function roleOf(project: Project | null): ProjectRole | null {
  if (!project) return null;
  return project.my_role ?? project.membership_role ?? project.access_role ?? project.role ?? (project.is_owner ? "owner" : null);
}

export const useProjectStore = defineStore("project", () => {
  const app = useAppStore();
  const session = ref<AnonymousSession | null>(null);
  const publicProjects = ref<Project[]>([]);
  const currentProjectId = ref("");
  const currentProject = ref<Project | null>(null);
  const alignTrees = ref<AlignTree[]>([]);
  const currentTreeId = ref("");
  const members = ref<ProjectMember[]>([]);
  const accessRequests = ref<ProjectAccessRequest[]>([]);
  const userCandidates = ref<UserSummary[]>([]);
  const auditEvents = ref<AuditEvent[]>([]);
  const loadingProject = ref(false);
  const bootstrapped = ref(false);
  const lease = ref<EditLease | null>(null);
  const leaseState = ref<LeaseState>("idle");
  const autosaveState = ref<AutosaveState>("idle");
  const lastSavedAt = ref<string | null>(null);
  const clientInstanceId = newClientInstanceId();
  let heartbeatTimer: number | null = null;
  let projectActivationNonce = 0;
  let treeActivationNonce = 0;
  let pendingProjectLoad: { id: string; nonce: number; promise: Promise<boolean> } | null = null;
  let bootstrapPromise: Promise<void> | null = null;
  // The registered resetGraph callback also clears the graph store's undo/redo history.
  let resetGraphAndHistory: (() => void) | null = null;

  // Compatibility alias used by existing graph/editor components. It now
  // explicitly means the selected Align Tree, never the workspace Project.
  const projectId = computed({ get: () => currentTreeId.value, set: (value: string) => { currentTreeId.value = value } });
  const projects = computed(() => alignTrees.value);
  const currentTree = computed(() => alignTrees.value.find((tree) => tree.id === currentTreeId.value) ?? null);
  const currentRole = computed(() => roleOf(currentProject.value));
  const hasMembership = computed(() => currentRole.value !== null);
  const canAdminProject = computed(() => currentRole.value === "owner" || currentRole.value === "admin");
  const canEditProject = computed(() => currentRole.value === "owner" || currentRole.value === "admin" || currentRole.value === "editor");
  const workflowStatus = computed(() => currentTree.value?.workflow_status ?? "draft");
  const workflowLocked = computed(() => Boolean(currentTree.value) && workflowStatus.value !== "draft");
  const currentRevision = computed(() => currentProject.value?.revision ?? lease.value?.revision ?? currentTree.value?.revision ?? null);
  const canEdit = computed(() => canEditProject.value && !workflowLocked.value && leaseState.value === "held" && Boolean(lease.value?.lease_token));
  const readOnly = computed(() => Boolean(currentProjectId.value) && !canEdit.value);
  const accessRequestStatus = computed<AccessRequestStatus | null>(() => currentProject.value?.access_request_status ?? null);
  const readOnlyReason = computed(() => {
    if (!hasMembership.value) return accessRequestStatus.value === "pending" ? "프로젝트 사용 신청이 승인 대기 중입니다." : "프로젝트 멤버만 내부 데이터를 볼 수 있습니다.";
    if (currentRole.value === "viewer") return "보기 권한으로 열었습니다.";
    if (workflowStatus.value === "in_review") return "검토 요청된 Editor는 승인 또는 반려 전까지 편집할 수 없습니다.";
    if (workflowStatus.value === "approved") return "승인된 Editor입니다. 수정하려면 새 Draft를 시작하세요.";
    if (workflowStatus.value === "published") return "공식 배포된 Editor입니다. 수정하려면 새 Draft를 시작하세요.";
    if (leaseState.value === "locked") {
      const holder = currentProject.value?.lock_holder_display_name;
      return holder ? `${holder}님이 이 프로젝트를 편집 중이라 보기 전용으로 열었습니다.` : "다른 사용자가 이 프로젝트를 편집 중이라 보기 전용으로 열었습니다.";
    }
    if (leaseState.value === "lost") return "편집 연결이 끊겨 보기 전용으로 전환되었습니다.";
    if (leaseState.value === "acquiring") return "프로젝트 편집 권한을 확인하고 있습니다.";
    return readOnly.value ? "편집을 시작하면 변경사항이 서버에 자동 저장됩니다." : "";
  });
  const autosaveLabel = computed(() => autosaveState.value === "saving" ? "저장 중…"
    : autosaveState.value === "error" ? "자동 저장 실패"
      : autosaveState.value === "conflict" ? "서버 변경 충돌"
        : autosaveState.value === "saved" ? "모든 변경사항 저장됨" : "서버 자동 저장");

  configureProjectRequestContext(
    () => ({
      projectId: currentProjectId.value,
      treeId: currentTreeId.value,
      leaseToken: lease.value?.lease_token ?? null,
      revision: currentRevision.value,
      readOnly: readOnly.value,
    }),
    (requestProjectId, revision) => {
      if (requestProjectId === currentProjectId.value) setRevision(revision);
    },
  );

  function setRevision(revision: number) {
    if (!Number.isFinite(revision)) return;
    if (lease.value) lease.value = { ...lease.value, revision };
    if (currentProject.value) currentProject.value = { ...currentProject.value, revision };
    publicProjects.value = publicProjects.value.map((row) => row.id === currentProjectId.value ? { ...row, revision } : row);
  }

  function syncProject(next: Project) {
    if (!currentProjectId.value || currentProjectId.value === next.id) {
      currentProject.value = currentProject.value?.id === next.id ? { ...currentProject.value, ...next } : next;
    }
    const exists = publicProjects.value.some((row) => row.id === next.id);
    publicProjects.value = exists
      ? publicProjects.value.map((row) => row.id === next.id ? { ...row, ...next } : row)
      : [next, ...publicProjects.value];
  }

  function syncTree(next: AlignTree) {
    if (next.project_id !== currentProjectId.value) return;
    const exists = alignTrees.value.some((row) => row.id === next.id);
    alignTrees.value = exists ? alignTrees.value.map((row) => row.id === next.id ? { ...row, ...next } : row) : [next, ...alignTrees.value];
  }

  function stopHeartbeat() {
    if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = window.setInterval(() => void heartbeat(), HEARTBEAT_MS);
  }

  async function heartbeat() {
    const active = lease.value;
    const projectId = currentProjectId.value;
    if (!active?.lease_token || !projectId || leaseState.value !== "held") return;
    try {
      const refreshed = await api.heartbeatLease(projectId, clientInstanceId, active.lease_token);
      if (currentProjectId.value !== projectId || lease.value?.lease_token !== active.lease_token || leaseState.value !== "held") return;
      lease.value = { ...active, ...refreshed, project_id: projectId, client_instance_id: clientInstanceId };
      if (refreshed.revision !== undefined) setRevision(refreshed.revision);
    } catch (error) {
      if (currentProjectId.value !== projectId || lease.value?.lease_token !== active.lease_token) return;
      stopHeartbeat();
      lease.value = null;
      leaseState.value = error instanceof ApiError && error.status === 423 ? "locked" : "lost";
      app.status = "프로젝트 편집 연결이 끊겨 보기 전용으로 전환되었습니다.";
      void loadPublicProjects(false);
    }
  }

  async function bootstrap() {
    if (bootstrapped.value) return;
    if (!bootstrapPromise) {
      bootstrapPromise = (async () => {
        session.value = await api.me();
        await loadPublicProjects(false);
        bootstrapped.value = true;
      })();
    }
    try { await bootstrapPromise }
    finally { bootstrapPromise = null }
  }

  async function updateDisplayName(displayName: string) {
    session.value = await app.run("표시 이름 변경", () => api.updateMe(displayName.trim()));
    await loadPublicProjects(false);
  }

  async function loadPublicProjects(showStatus = true) {
    const load = async () => { publicProjects.value = await api.listProjects(); };
    if (showStatus) await app.run("공개 프로젝트 불러오기", load); else await load();
  }

  const loadProjects = loadPublicProjects;

  async function createProject(body: ProjectCreate) {
    const created = await app.run("프로젝트 생성", () => api.createProject(body));
    projectActivationNonce += 1;
    treeActivationNonce += 1;
    pendingProjectLoad = null;
    loadingProject.value = false;
    currentProjectId.value = created.id;
    currentProject.value = null;
    syncProject(created);
    currentTreeId.value = "";
    return created;
  }

  async function branchProject(body: ProjectCreate) {
    if (!currentProjectId.value) throw new Error("복제할 프로젝트를 먼저 선택하세요.");
    const created = await app.run(
      "현재 설정으로 새 프로젝트 만들기",
      () => api.branchProject(currentProjectId.value, body),
    );
    await loadPublicProjects(false);
    return created;
  }

  function registerWorkspaceReset(reset: () => void) {
    resetGraphAndHistory = reset;
  }

  async function activateProjectSelection(id: string, resetWorkspace: boolean) {
    if (!id) return false;
    if (pendingProjectLoad?.id === id) return pendingProjectLoad.promise;
    if (currentProjectId.value === id && currentProject.value?.id === id) return true;

    const nonce = ++projectActivationNonce;
    if (resetWorkspace && currentProjectId.value !== id) resetGraphAndHistory?.();
    const promise = (async () => {
      const changed = currentProjectId.value !== id;
      if (changed) {
        await releaseLease();
        if (nonce !== projectActivationNonce) return false;
        treeActivationNonce += 1;
        currentProjectId.value = id;
        currentProject.value = null;
        currentTreeId.value = "";
        alignTrees.value = [];
        members.value = [];
        accessRequests.value = [];
        userCandidates.value = [];
        auditEvents.value = [];
        autosaveState.value = "idle";
      }
      if (nonce !== projectActivationNonce || currentProjectId.value !== id) return false;
      loadingProject.value = true;
      try {
        const loaded = await api.getProject(id);
        if (nonce !== projectActivationNonce || currentProjectId.value !== id) return false;
        syncProject(loaded);
        return true;
      } finally {
        if (nonce === projectActivationNonce) loadingProject.value = false;
      }
    })();
    pendingProjectLoad = { id, nonce, promise };
    try { return await promise }
    finally {
      if (pendingProjectLoad?.nonce === nonce) pendingProjectLoad = null;
    }
  }

  async function loadProject(id: string) { return activateProjectSelection(id, false) }
  async function selectProject(id: string) { return activateProjectSelection(id, true) }

  function clearProjectSelection() {
    projectActivationNonce += 1;
    treeActivationNonce += 1;
    pendingProjectLoad = null;
    loadingProject.value = false;
    currentProjectId.value = "";
    currentProject.value = null;
    currentTreeId.value = "";
    alignTrees.value = [];
    members.value = [];
    accessRequests.value = [];
    userCandidates.value = [];
    auditEvents.value = [];
    autosaveState.value = "idle";
  }

  async function updateProject(id: string, body: ProjectUpdate) {
    if (currentProjectId.value !== id && !await selectProject(id)) throw new ApiError(409, "프로젝트 선택이 변경되었습니다.");
    if (currentProjectId.value !== id) throw new ApiError(409, "프로젝트 선택이 변경되었습니다.");
    await requireEditLease();
    markSaving();
    try {
      const updated = await app.run("프로젝트 정보 변경", () => api.updateProject(id, body));
      syncProject(updated);
      if (currentProjectId.value === id) markSaved();
      return updated;
    } catch (error) { if (currentProjectId.value === id) handleMutationError(error); throw error }
  }

  async function deleteProject(id: string) {
    if (currentProjectId.value !== id && !await selectProject(id)) throw new ApiError(409, "프로젝트 선택이 변경되었습니다.");
    if (currentProjectId.value !== id) throw new ApiError(409, "프로젝트 선택이 변경되었습니다.");
    await requireEditLease();
    await app.run("프로젝트 삭제", () => api.deleteProject(id));
    await releaseLease();
    publicProjects.value = publicProjects.value.filter((row) => row.id !== id);
    clearProjectSelection();
  }

  async function requestAccess(requestedRole: "viewer" | "editor", message: string) {
    if (!currentProjectId.value) return;
    const projectId = currentProjectId.value;
    const request = await app.run("프로젝트 사용 신청", () => api.requestProjectAccess(projectId, requestedRole, message));
    if (currentProjectId.value !== projectId) return;
    if (currentProject.value) currentProject.value = { ...currentProject.value, access_request_status: request.status };
    publicProjects.value = publicProjects.value.map((row) => row.id === currentProjectId.value ? { ...row, access_request_status: request.status } : row);
  }

  async function claimLegacyProject(id: string) {
    const claimed = await app.run("기존 프로젝트 가져오기", () => api.claimLegacyProject(id));
    projectActivationNonce += 1;
    treeActivationNonce += 1;
    pendingProjectLoad = null;
    loadingProject.value = false;
    currentProjectId.value = claimed.id;
    currentProject.value = null;
    syncProject(claimed);
    return claimed;
  }

  async function loadAuditEvents() {
    if (!currentProjectId.value || !hasMembership.value) { auditEvents.value = []; return }
    const projectId = currentProjectId.value;
    const events = await api.projectAuditEvents(projectId, { changesOnly: true });
    if (currentProjectId.value === projectId) auditEvents.value = events.filter(isChangeAuditEvent);
  }

  async function loadMembersAndRequests() {
    if (!currentProjectId.value || !canAdminProject.value) { members.value = []; accessRequests.value = []; return }
    const projectId = currentProjectId.value;
    const [nextMembers, nextRequests] = await Promise.all([
      api.listProjectMembers(projectId), api.listProjectAccessRequests(projectId),
    ]);
    if (currentProjectId.value === projectId && canAdminProject.value) {
      members.value = nextMembers;
      accessRequests.value = nextRequests;
    }
  }

  async function reviewAccessRequest(requestId: string, status: "approved" | "rejected", role: ProjectRole = "viewer") {
    if (!currentProjectId.value) return;
    const projectId = currentProjectId.value;
    const updated = await api.reviewProjectAccessRequest(projectId, requestId, status, role);
    if (currentProjectId.value !== projectId) return;
    accessRequests.value = accessRequests.value.map((row) => row.id === requestId ? updated : row);
    if (status === "approved") {
      const nextMembers = await api.listProjectMembers(projectId);
      if (currentProjectId.value !== projectId) return;
      members.value = nextMembers;
      if (currentProject.value) currentProject.value = { ...currentProject.value, member_count: members.value.length };
    }
  }

  async function updateMemberRole(memberId: string, role: ProjectRole) {
    if (!currentProjectId.value) return;
    const projectId = currentProjectId.value;
    const updated = await api.updateProjectMember(projectId, memberId, role);
    if (currentProjectId.value !== projectId) return;
    members.value = members.value.map((row) => (row.actor?.id ?? row.actor_id ?? row.id) === memberId ? updated : row);
  }

  async function searchUsers(query: string) {
    if (!currentProjectId.value || !canAdminProject.value || query.trim().length < 2) { userCandidates.value = []; return }
    const projectId = currentProjectId.value;
    const candidates = await api.searchUsers(projectId, query.trim());
    if (currentProjectId.value === projectId && canAdminProject.value) userCandidates.value = candidates;
  }

  async function addMember(actorId: string, role: ProjectRole) {
    if (!currentProjectId.value) return;
    const projectId = currentProjectId.value;
    const added = await api.addProjectMember(projectId, actorId, role);
    if (currentProjectId.value !== projectId) return;
    const addedActorId = added.actor?.id ?? added.actor_id ?? added.id;
    const exists = members.value.some((row) => (row.actor?.id ?? row.actor_id ?? row.id) === addedActorId);
    members.value = exists ? members.value.map((row) => (row.actor?.id ?? row.actor_id ?? row.id) === addedActorId ? added : row) : [...members.value, added];
    if (currentProject.value) currentProject.value = { ...currentProject.value, member_count: members.value.length };
  }

  async function removeMember(memberId: string) {
    if (!currentProjectId.value) return;
    const projectId = currentProjectId.value;
    await api.removeProjectMember(projectId, memberId);
    if (currentProjectId.value !== projectId) return;
    members.value = members.value.filter((row) => (row.actor?.id ?? row.actor_id ?? row.id) !== memberId);
    if (currentProject.value) currentProject.value = { ...currentProject.value, member_count: members.value.length };
  }

  async function loadAlignTrees() {
    if (!currentProjectId.value || !hasMembership.value) { alignTrees.value = []; return }
    const projectId = currentProjectId.value;
    const trees = await api.listAlignTrees(projectId);
    if (currentProjectId.value === projectId) alignTrees.value = trees;
  }

  async function createAlignTree(body: AlignTreeCreate) {
    if (!currentProjectId.value) throw new Error("프로젝트를 먼저 선택하세요.");
    const projectId = currentProjectId.value;
    await requireEditLease();
    markSaving();
    try {
      const created = await app.run("Align Tree 생성", () => api.createAlignTree(projectId, body));
      syncTree(created);
      if (currentProjectId.value === projectId && currentProject.value) currentProject.value = { ...currentProject.value, align_tree_count: (currentProject.value.align_tree_count ?? 0) + 1 };
      if (currentProjectId.value === projectId) markSaved();
      return created;
    } catch (error) { if (currentProjectId.value === projectId) handleMutationError(error); throw error }
  }

  async function updateAlignTree(treeId: string, body: Partial<AlignTreeCreate>) {
    if (!currentProjectId.value) throw new Error("프로젝트를 먼저 선택하세요.");
    const projectId = currentProjectId.value;
    await requireEditLease();
    markSaving();
    try {
      const updated = await api.updateAlignTree(projectId, treeId, body);
      syncTree(updated);
      if (currentProjectId.value === projectId) markSaved();
      return updated;
    } catch (error) { if (currentProjectId.value === projectId) handleMutationError(error); throw error }
  }

  async function deleteAlignTree(treeId: string) {
    if (!currentProjectId.value) return;
    const projectId = currentProjectId.value;
    await requireEditLease();
    markSaving();
    try {
      await api.deleteAlignTree(projectId, treeId);
      if (currentProjectId.value !== projectId) return;
      alignTrees.value = alignTrees.value.filter((row) => row.id !== treeId);
      if (currentProject.value) currentProject.value = { ...currentProject.value, align_tree_count: Math.max(0, (currentProject.value.align_tree_count ?? alignTrees.value.length + 1) - 1) };
      if (currentTreeId.value === treeId) currentTreeId.value = "";
      markSaved();
    } catch (error) { if (currentProjectId.value === projectId) handleMutationError(error); throw error }
  }

  async function ensureEditLease(force = false): Promise<boolean> {
    const projectId = currentProjectId.value;
    const projectNonce = projectActivationNonce;
    if (!projectId || !canEditProject.value) { leaseState.value = "viewer"; return false }
    if (lease.value?.project_id === projectId && leaseState.value === "held") return true;
    leaseState.value = "acquiring";
    try {
      const result = await api.acquireLease(projectId, clientInstanceId, force);
      if (projectId !== currentProjectId.value || projectNonce !== projectActivationNonce) {
        try { await api.releaseLease(projectId, result.lease_token) } catch { /* Server TTL is the final fallback. */ }
        return false;
      }
      lease.value = { ...result, project_id: projectId, client_instance_id: clientInstanceId };
      leaseState.value = "held";
      if (currentProject.value) currentProject.value = {
        ...currentProject.value,
        is_locked: true,
        locked_by_me: true,
        lock_expires_at: result.expires_at,
        lock_holder_display_name: session.value?.display_name ?? null,
      };
      if (result.revision !== undefined) setRevision(result.revision);
      startHeartbeat();
      return true;
    } catch (error) {
      if (projectId !== currentProjectId.value || projectNonce !== projectActivationNonce) return false;
      lease.value = null;
      leaseState.value = error instanceof ApiError && error.status === 423 ? "locked" : "lost";
      if (error instanceof ApiError && error.status === 423 && currentProject.value) {
        const detail = error.detail && typeof error.detail === "object" ? error.detail as Record<string, unknown> : null;
        currentProject.value = {
          ...currentProject.value,
          is_locked: true,
          locked_by_me: false,
          lock_holder_display_name: typeof detail?.holder_display_name === "string" ? detail.holder_display_name : currentProject.value.lock_holder_display_name,
          lock_expires_at: typeof detail?.expires_at === "string" ? detail.expires_at : currentProject.value.lock_expires_at,
        };
      }
      if (!(error instanceof ApiError) || error.status !== 423) throw error;
      return false;
    }
  }

  async function requireEditLease() {
    if (canEdit.value) return;
    if (!await ensureEditLease()) throw new ApiError(423, readOnlyReason.value || "프로젝트 편집 잠금을 얻지 못했습니다.");
  }

  const acquireEdit = ensureEditLease;

  async function activateTree(treeId: string, force = false) {
    const nonce = ++treeActivationNonce;
    const containerProjectId = currentProjectId.value;
    currentTreeId.value = treeId;
    let selected = alignTrees.value.find((row) => row.id === treeId);
    if (!selected && containerProjectId) {
      selected = await api.getAlignTree(containerProjectId, treeId);
      if (nonce !== treeActivationNonce || currentProjectId.value !== containerProjectId) return false;
      syncTree(selected);
    }
    if (nonce !== treeActivationNonce || currentProjectId.value !== containerProjectId) return false;
    if (!canEditProject.value) { leaseState.value = "viewer"; return false }
    return ensureEditLease(force);
  }

  const activateProject = activateTree;

  async function releaseLease(keepalive = false) {
    stopHeartbeat();
    const active = lease.value;
    const projectId = active?.project_id ?? currentProjectId.value;
    lease.value = null;
    leaseState.value = "idle";
    if (currentProject.value) currentProject.value = {
      ...currentProject.value,
      is_locked: false,
      locked_by_me: false,
      lock_expires_at: null,
      lock_holder_display_name: null,
    };
    if (!active?.lease_token || !projectId) return;
    try { await api.releaseLease(projectId, active.lease_token, keepalive) } catch { /* Server TTL is the final fallback. */ }
  }

  function markSaving() { autosaveState.value = "saving" }
  function markSaved() { autosaveState.value = "saved"; lastSavedAt.value = new Date().toISOString() }
  function markSaveError(error: unknown) {
    autosaveState.value = error instanceof ApiError && error.status === 409 ? "conflict" : "error";
  }
  function flushAutosave() {
    app.status = autosaveState.value === "saving" ? "변경사항을 서버에 저장하고 있습니다." : autosaveLabel.value;
  }

  function handleMutationError(error: unknown) {
    markSaveError(error);
    if (!(error instanceof ApiError)) return;
    if (error.status === 409 && error.detail && typeof error.detail === "object") {
      const revision = Number((error.detail as Record<string, unknown>).current_revision);
      if (Number.isFinite(revision)) setRevision(revision);
    }
    if (error.status === 423 || error.status === 428) {
      stopHeartbeat();
      lease.value = null;
      leaseState.value = error.status === 423 ? "locked" : "lost";
    }
  }

  return {
    session, publicProjects, projects, currentProjectId, currentProject, alignTrees, currentTreeId, currentTree, projectId,
    members, accessRequests, userCandidates, auditEvents, loadingProject, bootstrapped, lease, leaseState, clientInstanceId, autosaveState, autosaveLabel, lastSavedAt,
    currentRole, currentRevision, hasMembership, canAdminProject, canEditProject, workflowStatus, workflowLocked, canEdit, readOnly, readOnlyReason, accessRequestStatus,
    bootstrap, updateDisplayName, loadPublicProjects, loadProjects, createProject, branchProject, loadProject, selectProject, clearProjectSelection, updateProject, deleteProject,
    requestAccess, claimLegacyProject, loadAuditEvents, loadMembersAndRequests, reviewAccessRequest, searchUsers, addMember, updateMemberRole, removeMember,
    loadAlignTrees, createAlignTree, updateAlignTree, deleteAlignTree, ensureEditLease, acquireEdit, activateTree, activateProject, releaseLease,
    syncProject, syncTree, setRevision, registerWorkspaceReset, markSaving, markSaved, markSaveError, flushAutosave, handleMutationError,
  };
});
