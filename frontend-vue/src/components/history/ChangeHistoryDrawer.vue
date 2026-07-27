<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { api } from "../../api/client";
import { auditActorName, auditEventChanges, auditEventTitle, isChangeAuditEvent } from "../../domain/audit";
import type { AuditEvent } from "../../types";

const props = withDefaults(defineProps<{
  projectId: string;
  title: string;
  alignTreeId?: string;
  targetId?: string;
  eventPrefixes?: string[];
}>(), {
  alignTreeId: "",
  targetId: "",
  eventPrefixes: () => [],
});
const emit = defineEmits<{ close: [] }>();
const events = ref<AuditEvent[]>([]);
const loading = ref(false);
const error = ref("");
let loadNonce = 0;
const queryKey = computed(() => JSON.stringify([
  props.projectId,
  props.alignTreeId,
  props.targetId,
  props.eventPrefixes,
]));

async function load() {
  if (!props.projectId) return;
  const nonce = ++loadNonce;
  loading.value = true;
  error.value = "";
  try {
    const nextEvents = await api.projectAuditEvents(props.projectId, {
      limit: 100,
      changesOnly: true,
      alignTreeId: props.alignTreeId || undefined,
      targetId: props.targetId || undefined,
      eventPrefixes: props.eventPrefixes,
    });
    if (nonce !== loadNonce) return;
    events.value = nextEvents.filter(isChangeAuditEvent);
  } catch (loadError) {
    if (nonce !== loadNonce) return;
    error.value = loadError instanceof Error ? loadError.message : String(loadError);
  } finally {
    if (nonce !== loadNonce) return;
    loading.value = false;
  }
}

watch(queryKey, load, { immediate: true });
</script>

<template>
  <aside class="change-history-drawer" aria-label="변경 이력">
    <header>
      <div>
        <p class="eyebrow">CHANGE HISTORY</p>
        <h2>{{ title }}</h2>
        <span>실제 데이터 변경만 표시합니다.</span>
      </div>
      <button aria-label="변경 이력 닫기" title="닫기" @click="emit('close')">×</button>
    </header>

    <div class="change-history-toolbar">
      <span>{{ events.length }}건</span>
      <button :disabled="loading" @click="load">{{ loading ? "불러오는 중…" : "새로고침" }}</button>
    </div>

    <p v-if="error" class="change-history-error">{{ error }}</p>
    <p v-else-if="!loading && !events.length" class="change-history-empty">이 범위에서 수정된 기록이 없습니다.</p>

    <ol v-else class="change-history-list">
      <li v-for="event in events" :key="event.id">
        <i/>
        <div>
          <strong>{{ auditEventTitle(event) }}</strong>
          <ul v-if="auditEventChanges(event).length">
            <li v-for="change in auditEventChanges(event)" :key="change">{{ change }}</li>
          </ul>
          <span><b>{{ auditActorName(event) }}</b> · {{ new Date(event.created_at).toLocaleString() }}</span>
        </div>
      </li>
    </ol>
  </aside>
</template>
