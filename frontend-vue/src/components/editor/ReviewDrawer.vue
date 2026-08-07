<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { AtSign, Bell, CheckCircle2, ImagePlus, MessageSquare, RefreshCw, Reply, RotateCcw, Send, UserRound, X } from "@lucide/vue";
import { api, reviewAttachmentUrl } from "../../api/client";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";
import { useProjectStore } from "../../stores/project";
import type { ReviewAttachmentInput, ReviewNotification, ReviewTargetDraft, ReviewTargetType, ReviewThread, SelectionItem, UserSummary } from "../../types";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const threads = ref<ReviewThread[]>([]);
const assignees = ref<UserSummary[]>([]);
const notifications = ref<ReviewNotification[]>([]);
const filter = ref<"open" | "resolved">("open");
const body = ref("");
const assigneeId = ref("");
const mentions = ref<string[]>([]);
const attachments = ref<ReviewAttachmentInput[]>([]);
const replyTo = ref<{ threadId: string; commentId: string } | null>(null);
const replyBodies = reactive<Record<string, string>>({});
const replyMentions = reactive<Record<string, string[]>>({});
const replyAttachments = reactive<Record<string, ReviewAttachmentInput[]>>({});
const loading = ref(false);
const saving = ref(false);
const error = ref("");

const visibleThreads = computed(() => threads.value.filter((row) => row.status === filter.value));
const openCount = computed(() => threads.value.filter((row) => row.status === "open").length);

function layerName(id: string | null | undefined) {
  return graph.rawGraph?.layers.find((row) => row.id === id)?.name ?? "이름 없음";
}

const target = computed<ReviewTargetDraft>(() => {
  if (app.reviewTarget) return app.reviewTarget;
  const selected = app.selection.length === 1 ? app.selection[0] : null;
  if (selected?.kind === "layer") return { target_type: "layer", target_id: selected.id, target_label: `Layer · ${layerName(selected.id)}` };
  if (selected?.kind === "relation") {
    const relation = graph.rawGraph?.relations.find((row) => row.id === selected.id);
    const label = relation ? `${layerName(relation.parent_layer_id)} → ${layerName(relation.child_layer_id)}` : selected.id;
    return { target_type: "relation", target_id: selected.id, target_label: `Relation · ${label}` };
  }
  if (selected?.kind === "text") {
    const text = graph.rawGraph?.text_boxes.find((row) => row.id === selected.id)?.text.trim() || "Text Box";
    return { target_type: "text_box", target_id: selected.id, target_label: `Text Box · ${text.slice(0, 40)}` };
  }
  const point = app.lastCanvasActivity;
  return { target_type: "canvas", target_label: point ? `Canvas · (${Math.round(point.x)}, ${Math.round(point.y)})` : "Canvas", anchor_x: point?.x ?? null, anchor_y: point?.y ?? null };
});

function targetTypeLabel(type: ReviewTargetType) {
  return ({ layer: "Layer", relation: "Relation", text_box: "Text Box", canvas: "Canvas", validation_issue: "Validation", snapshot: "Snapshot" })[type];
}

async function load() {
  if (!props.open || !project.currentProjectId || !project.projectId) return;
  loading.value = true;
  error.value = "";
  try {
    [threads.value, assignees.value, notifications.value] = await Promise.all([
      api.listReviewThreads(project.currentProjectId, project.projectId),
      api.listReviewAssignees(project.currentProjectId),
      api.listReviewNotifications(project.currentProjectId),
    ]);
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : String(loadError);
  } finally {
    loading.value = false;
  }
}

function addMention(list: string[], actorId: string, textTarget: { value: string }) {
  if (!actorId || list.includes(actorId)) return;
  const actor = assignees.value.find((row) => row.id === actorId);
  list.push(actorId);
  if (actor) textTarget.value = `${textTarget.value}${textTarget.value && !textTarget.value.endsWith(" ") ? " " : ""}@${actor.display_name} `;
}

function removeMention(list: string[], actorId: string) {
  const index = list.indexOf(actorId);
  if (index >= 0) list.splice(index, 1);
}

function addComposeMention(actorId: string) {
  addMention(mentions.value, actorId, body);
}

function addReplyMention(threadId: string, actorId: string) {
  const list = replyMentions[threadId] ||= [];
  const textTarget = {
    get value() { return replyBodies[threadId] || ""; },
    set value(next: string) { replyBodies[threadId] = next; },
  };
  addMention(list, actorId, textTarget);
}

async function readAttachment(file: File, kind: "before" | "after") {
  if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(file.type)) throw new Error("PNG, JPG, WebP 이미지만 첨부할 수 있습니다.");
  if (file.size > 2 * 1024 * 1024) throw new Error("이미지는 장당 2MB 이하여야 합니다.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
  return { kind, filename: file.name, mime_type: file.type as ReviewAttachmentInput["mime_type"], data_base64: dataUrl.split(",", 2)[1] || "" };
}

async function storeAttachment(targetList: ReviewAttachmentInput[], kind: "before" | "after", file: File) {
  try {
    const next = await readAttachment(file, kind);
    const existing = targetList.findIndex((row) => row.kind === kind);
    if (existing >= 0) targetList.splice(existing, 1, next);
    else targetList.push(next);
  } catch (attachmentError) {
    error.value = attachmentError instanceof Error ? attachmentError.message : String(attachmentError);
  }
}

async function pasteAttachment(targetList: ReviewAttachmentInput[], kind: "before" | "after", event: ClipboardEvent) {
  const file = Array.from(event.clipboardData?.files || []).find((row) => row.type.startsWith("image/"));
  if (!file) return;
  event.preventDefault();
  await storeAttachment(targetList, kind, file);
}

function pasteComposeAttachment(event: ClipboardEvent) {
  const kind = attachments.value.some((row) => row.kind === "before") ? "after" : "before";
  return pasteAttachment(attachments.value, kind, event);
}

function pasteReplyAttachment(threadId: string, kind: "before" | "after", event: ClipboardEvent) {
  return pasteAttachment(replyAttachments[threadId] ||= [], kind, event);
}

function attachmentPreview(attachment: ReviewAttachmentInput) {
  return `data:${attachment.mime_type};base64,${attachment.data_base64}`;
}

async function createThread() {
  if (!body.value.trim() || !project.currentProjectId || !project.projectId || saving.value) return;
  saving.value = true;
  try {
    const created = await api.createReviewThread(project.currentProjectId, {
      ...target.value,
      align_tree_id: project.projectId,
      assignee_actor_id: assigneeId.value || null,
      body: body.value.trim(),
      mentioned_actor_ids: mentions.value,
      attachments: attachments.value,
    });
    threads.value = [created, ...threads.value];
    body.value = "";
    assigneeId.value = "";
    mentions.value = [];
    attachments.value = [];
    filter.value = "open";
  } catch (saveError) {
    error.value = saveError instanceof Error ? saveError.message : String(saveError);
  } finally {
    saving.value = false;
  }
}

async function addReply(thread: ReviewThread) {
  const reply = replyBodies[thread.id]?.trim();
  if (!reply || !project.currentProjectId || saving.value) return;
  saving.value = true;
  try {
    const updated = await api.addReviewComment(
      project.currentProjectId,
      thread.id,
      reply,
      replyTo.value?.threadId === thread.id ? replyTo.value.commentId : null,
      replyMentions[thread.id] || [],
      replyAttachments[thread.id] || [],
    );
    replaceThread(updated);
    replyBodies[thread.id] = "";
    replyMentions[thread.id] = [];
    replyAttachments[thread.id] = [];
    replyTo.value = null;
  } catch (saveError) {
    error.value = saveError instanceof Error ? saveError.message : String(saveError);
  } finally {
    saving.value = false;
  }
}

async function markNotificationsRead() {
  if (!project.currentProjectId || !notifications.value.length) return;
  await api.markReviewNotificationsRead(project.currentProjectId, notifications.value.map((row) => row.id));
  notifications.value = [];
}

async function setStatus(thread: ReviewThread, status: "open" | "resolved") {
  if (project.currentProjectId) replaceThread(await api.updateReviewThread(project.currentProjectId, thread.id, { status }));
}

async function setAssignee(thread: ReviewThread, actorId: string) {
  if (project.currentProjectId) replaceThread(await api.updateReviewThread(project.currentProjectId, thread.id, { assignee_actor_id: actorId || null, assignee_set: true }));
}

function replaceThread(updated: ReviewThread) {
  threads.value = threads.value.map((row) => row.id === updated.id ? updated : row);
}

function focusTarget(thread: ReviewThread) {
  if (!thread.target_id) return;
  const kind = thread.target_type === "text_box" ? "text" : thread.target_type;
  if (kind === "layer" || kind === "relation" || kind === "text") {
    app.select({ kind, id: thread.target_id } as SelectionItem);
    if (kind === "layer") app.focusRequest = { layerId: thread.target_id, nonce: Date.now() };
  }
}

watch(() => [props.open, project.currentProjectId, project.projectId], load, { immediate: true });
</script>

<template>
  <aside v-if="open" class="review-drawer" aria-label="리뷰 및 코멘트">
    <header>
      <div><p class="eyebrow">REVIEW</p><h2>코멘트 및 이슈</h2><span>미해결 {{ openCount }}건</span></div>
      <div class="review-header-actions">
        <button v-if="notifications.length" class="review-notification" title="멘션 알림 모두 읽음" @click="markNotificationsRead"><Bell :size="15"/>{{ notifications.length }}</button>
        <button class="icon-button" title="닫기" aria-label="리뷰 패널 닫기" @click="emit('close')"><X :size="18"/></button>
      </div>
    </header>
    <section class="review-compose">
      <strong>{{ target.target_label }}</strong>
      <textarea v-model="body" rows="3" placeholder="검토할 내용이나 수정 요청을 입력하세요" @paste="pasteComposeAttachment"/>
      <div class="review-compose-options">
        <label><UserRound :size="14"/><select v-model="assigneeId"><option value="">담당자 없음</option><option v-for="actor in assignees" :key="actor.id" :value="actor.id">{{ actor.display_name }}</option></select></label>
        <label><AtSign :size="14"/><select value="" @change="addComposeMention(($event.target as HTMLSelectElement).value)"><option value="">멘션 추가</option><option v-for="actor in assignees" :key="actor.id" :value="actor.id" :disabled="mentions.includes(actor.id)">{{ actor.display_name }}</option></select></label>
      </div>
      <div v-if="mentions.length" class="review-mention-chips"><button v-for="actorId in mentions" :key="actorId" @click="removeMention(mentions, actorId)">@{{ assignees.find((row) => row.id === actorId)?.display_name }} <X :size="11"/></button></div>
      <div class="review-attachment-tools">
        <span class="review-paste-target" tabindex="0" @paste="pasteAttachment(attachments, 'before', $event)"><ImagePlus :size="14"/>변경 전 붙여넣기</span>
        <span class="review-paste-target" tabindex="0" @paste="pasteAttachment(attachments, 'after', $event)"><ImagePlus :size="14"/>변경 후 붙여넣기</span>
        <button class="primary" :disabled="!body.trim() || saving" @click="createThread"><MessageSquare :size="15"/>등록</button>
      </div>
      <div v-if="attachments.length" class="review-pending-images"><button v-for="attachment in attachments" :key="attachment.kind" @click="attachments = attachments.filter((row) => row.kind !== attachment.kind)"><img :src="attachmentPreview(attachment)" :alt="attachment.filename"><span>{{ attachment.kind === 'before' ? '변경 전' : '변경 후' }}</span><X :size="12"/></button></div>
    </section>
    <div class="review-toolbar"><div class="segmented"><button :class="{ active: filter === 'open' }" @click="filter = 'open'">Open {{ openCount }}</button><button :class="{ active: filter === 'resolved' }" @click="filter = 'resolved'">Resolved</button></div><button class="icon-button" title="새로고침" aria-label="리뷰 새로고침" :disabled="loading" @click="load"><RefreshCw :size="16"/></button></div>
    <div class="review-list">
      <p v-if="error" class="review-error">{{ error }}</p>
      <p v-else-if="!loading && !visibleThreads.length" class="review-empty">{{ filter === 'open' ? '미해결 리뷰가 없습니다.' : '해결된 리뷰가 없습니다.' }}</p>
      <article v-for="thread in visibleThreads" :key="thread.id" class="review-thread">
        <button class="review-target" :disabled="!thread.target_id" @click="focusTarget(thread)"><span>{{ targetTypeLabel(thread.target_type) }}</span><strong>{{ thread.target_label }}</strong></button>
        <div class="review-meta"><span>{{ thread.created_by?.display_name || '작성자 없음' }} · {{ new Date(thread.created_at).toLocaleString() }}</span><select v-if="project.canEditProject" :value="thread.assignee?.id || ''" title="담당자" @change="setAssignee(thread, ($event.target as HTMLSelectElement).value)"><option value="">담당자 없음</option><option v-for="actor in assignees" :key="actor.id" :value="actor.id">{{ actor.display_name }}</option></select><span v-else>{{ thread.assignee?.display_name || '담당자 없음' }}</span></div>
        <div class="review-comments">
          <div v-for="comment in thread.comments" :key="comment.id" class="review-comment" :class="{ reply: comment.parent_comment_id }">
            <div><b>{{ comment.author?.display_name || comment.author_label }}</b><time>{{ new Date(comment.created_at).toLocaleString() }}</time></div><p>{{ comment.body }}</p>
            <div v-if="comment.attachments.length" class="review-attached-images"><a v-for="attachment in comment.attachments" :key="attachment.id" :href="reviewAttachmentUrl(project.currentProjectId, attachment.id)" target="_blank"><img :src="reviewAttachmentUrl(project.currentProjectId, attachment.id)" :alt="attachment.filename"><span>{{ attachment.kind === 'before' ? '변경 전' : '변경 후' }}</span></a></div>
            <button @click="replyTo = { threadId: thread.id, commentId: comment.id }"><Reply :size="13"/>답글</button>
          </div>
        </div>
        <div class="review-reply">
          <span v-if="replyTo?.threadId === thread.id">답글 작성 중<button @click="replyTo = null"><X :size="12"/></button></span>
          <div><input v-model="replyBodies[thread.id]" placeholder="댓글을 입력하세요" @paste="pasteReplyAttachment(thread.id, (replyAttachments[thread.id] || []).some((row) => row.kind === 'before') ? 'after' : 'before', $event)" @keydown.enter.prevent="addReply(thread)"/><button class="icon-button" title="댓글 등록" :disabled="!replyBodies[thread.id]?.trim() || saving" @click="addReply(thread)"><Send :size="16"/></button></div>
          <div class="review-reply-tools">
            <label><AtSign :size="13"/><select value="" @change="addReplyMention(thread.id, ($event.target as HTMLSelectElement).value)"><option value="">멘션</option><option v-for="actor in assignees" :key="actor.id" :value="actor.id">{{ actor.display_name }}</option></select></label>
            <span class="review-paste-target" tabindex="0" title="변경 전 이미지 붙여넣기" @paste="pasteReplyAttachment(thread.id, 'before', $event)"><ImagePlus :size="13"/>전 붙여넣기</span>
            <span class="review-paste-target" tabindex="0" title="변경 후 이미지 붙여넣기" @paste="pasteReplyAttachment(thread.id, 'after', $event)"><ImagePlus :size="13"/>후 붙여넣기</span>
          </div>
        </div>
        <button v-if="project.canEditProject" class="review-status" @click="setStatus(thread, thread.status === 'open' ? 'resolved' : 'open')"><CheckCircle2 v-if="thread.status === 'open'" :size="15"/><RotateCcw v-else :size="15"/>{{ thread.status === 'open' ? '해결 처리' : '다시 열기' }}</button>
      </article>
    </div>
  </aside>
</template>
