<script setup lang="ts">
import { computed, ref } from "vue";
import { BadgeCheck, Check, CircleDot, LockKeyhole, RotateCcw, Send, Upload, X, XCircle } from "@lucide/vue";
import { api, describeErrorDetail } from "../../api/client";
import { useAppStore } from "../../stores/app";
import { useProjectStore } from "../../stores/project";
import type { AlignTree, WorkflowStatus } from "../../types";

type WorkflowAction = "request" | "reject" | "approve" | "publish" | "reopen";

const app = useAppStore();
const project = useProjectStore();
const open = ref(false);
const action = ref<WorkflowAction | null>(null);
const note = ref("");
const busy = ref(false);
const error = ref("");

const labels: Record<WorkflowStatus, string> = {
  draft: "Draft",
  in_review: "검토 중",
  approved: "승인 완료",
  published: "공식 배포",
};
const descriptions: Record<WorkflowStatus, string> = {
  draft: "현재 작업본을 편집할 수 있습니다.",
  in_review: "승인 또는 반려 전까지 Editor 편집이 잠겨 있습니다.",
  approved: "승인 Snapshot이 고정되었습니다.",
  published: "공식 사용 버전으로 배포되었습니다.",
};
const actionCopy: Record<WorkflowAction, { title: string; placeholder: string; submit: string }> = {
  request: { title: "검토 요청", placeholder: "변경 사유와 검토가 필요한 내용을 입력하세요.", submit: "검토 요청" },
  reject: { title: "검토 반려", placeholder: "수정해야 할 내용과 반려 사유를 입력하세요.", submit: "Draft로 반려" },
  approve: { title: "검토 승인", placeholder: "승인 근거 또는 확인한 내용을 입력하세요.", submit: "승인" },
  publish: { title: "공식 배포", placeholder: "배포 목적 또는 적용 대상을 입력하세요.", submit: "공식 배포" },
  reopen: { title: "새 Draft 시작", placeholder: "승인본 이후 수정이 필요한 이유를 입력하세요.", submit: "Draft 시작" },
};

const status = computed<WorkflowStatus>(() => project.workflowStatus as WorkflowStatus);
const current = computed(() => project.currentTree);
const selectedCopy = computed(() => action.value ? actionCopy[action.value] : null);

function choose(next: WorkflowAction) {
  action.value = next;
  note.value = "";
  error.value = "";
}
function close() {
  if (busy.value) return;
  open.value = false;
  action.value = null;
  note.value = "";
  error.value = "";
}
function sync(next: AlignTree) {
  project.syncTree(next);
  app.status = `Workflow: ${labels[next.workflow_status ?? "draft"]}`;
}
async function submit() {
  const selected = action.value;
  const message = note.value.trim();
  if (!selected || !message || !project.projectId) return;
  busy.value = true;
  error.value = "";
  project.markSaving();
  try {
    if (project.leaseState !== "held" && !await project.ensureEditLease()) {
      throw new Error(project.readOnlyReason || "편집 잠금을 얻지 못했습니다.");
    }
    const methods: Record<WorkflowAction, () => Promise<AlignTree>> = {
      request: () => api.requestWorkflowReview(project.projectId, message),
      reject: () => api.rejectWorkflowReview(project.projectId, message),
      approve: () => api.approveWorkflowReview(project.projectId, message),
      publish: () => api.publishWorkflow(project.projectId, message),
      reopen: () => api.reopenWorkflowDraft(project.projectId, message),
    };
    sync(await methods[selected]());
    project.markSaved();
    if (selected === "request" || selected === "approve" || selected === "publish") await project.releaseLease();
    open.value = false;
    action.value = null;
    note.value = "";
    error.value = "";
  } catch (workflowError) {
    project.handleMutationError(workflowError);
    const detail = workflowError && typeof workflowError === "object" && "detail" in workflowError
      ? (workflowError as { detail?: unknown }).detail
      : null;
    error.value = describeErrorDetail(detail) || (workflowError instanceof Error ? workflowError.message : String(workflowError));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <button class="workflow-trigger" :class="`is-${status}`" type="button" title="검토·승인 상태" @click="open = true">
    <CircleDot v-if="status === 'draft'" :size="15"/>
    <LockKeyhole v-else-if="status === 'in_review'" :size="15"/>
    <BadgeCheck v-else :size="15"/>
    <span>{{ labels[status] }}</span>
  </button>

  <div v-if="open" class="paste-overlay workflow-overlay" @click="close">
    <section class="panel workflow-panel" aria-label="Editor 검토 및 승인" @click.stop>
      <header class="workflow-heading">
        <div><p class="eyebrow">REVIEW WORKFLOW</p><h2>Editor 검토 및 승인</h2></div>
        <button type="button" title="닫기" aria-label="Workflow 닫기" @click="close"><X :size="18"/></button>
      </header>

      <div class="workflow-current" :class="`is-${status}`">
        <span><CircleDot :size="17"/><strong>{{ labels[status] }}</strong></span>
        <p>{{ descriptions[status] }}</p>
        <small v-if="current?.workflow_note">{{ current.workflow_note }}</small>
      </div>

      <div class="workflow-timeline" aria-label="Workflow 단계">
        <span v-for="(label, key) in labels" :key="key" :class="{ active: key === status }">{{ label }}</span>
      </div>

      <div v-if="!action" class="workflow-actions">
        <button v-if="status === 'draft' && project.canEditProject" class="primary" type="button" @click="choose('request')"><Send :size="16"/>검토 요청</button>
        <template v-else-if="status === 'in_review' && project.canAdminProject">
          <button class="danger ghost" type="button" @click="choose('reject')"><XCircle :size="16"/>반려</button>
          <button class="primary" type="button" @click="choose('approve')"><Check :size="16"/>승인</button>
        </template>
        <template v-else-if="status === 'approved'">
          <button v-if="project.canEditProject" type="button" @click="choose('reopen')"><RotateCcw :size="16"/>새 Draft</button>
          <button v-if="project.canAdminProject" class="primary" type="button" @click="choose('publish')"><Upload :size="16"/>공식 배포</button>
        </template>
        <button v-else-if="status === 'published' && project.canEditProject" type="button" @click="choose('reopen')"><RotateCcw :size="16"/>새 Draft 시작</button>
        <p v-else>현재 권한에서 실행할 수 있는 Workflow 작업이 없습니다.</p>
      </div>

      <form v-else class="workflow-form" @submit.prevent="submit">
        <div><strong>{{ selectedCopy?.title }}</strong><button type="button" @click="action = null">뒤로</button></div>
        <textarea v-model="note" maxlength="1000" :placeholder="selectedCopy?.placeholder" autofocus/>
        <p v-if="error" class="workflow-error">{{ error }}</p>
        <footer><span>{{ note.trim().length }}/1000</span><button class="primary" type="submit" :disabled="busy || !note.trim()">{{ busy ? "처리 중…" : selectedCopy?.submit }}</button></footer>
      </form>
    </section>
  </div>
</template>
