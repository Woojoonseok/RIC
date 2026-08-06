<script setup lang="ts">
import { ref, watch } from "vue";
import { AlertTriangle, ArrowDown, ArrowUp, RefreshCw } from "@lucide/vue";
import { api } from "../../api/client";
import { useAppStore } from "../../stores/app";
import { useProjectStore } from "../../stores/project";
import type { LayerImpactNode, RelationImpactReport } from "../../types";

const props = defineProps<{ relationId: string }>();
const app = useAppStore();
const project = useProjectStore();
const impact = ref<RelationImpactReport | null>(null);
const loading = ref(false);
const error = ref("");
let loadNonce = 0;

async function load() {
  if (!project.projectId || !props.relationId) return;
  const nonce = ++loadNonce;
  loading.value = true;
  error.value = "";
  try {
    const result = await api.relationImpact(project.projectId, props.relationId);
    if (nonce === loadNonce) impact.value = result;
  } catch (reason) {
    if (nonce === loadNonce) error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    if (nonce === loadNonce) loading.value = false;
  }
}
function selectLayer(row: LayerImpactNode) { app.select({ kind: "layer", id: row.id }) }

watch(() => [props.relationId, project.currentRevision], () => void load(), { immediate: true });
</script>

<template>
  <section class="layer-impact-summary">
    <div class="layer-impact-heading">
      <div><AlertTriangle :size="15"/><strong>변경 영향도</strong></div>
      <button title="영향도 새로고침" aria-label="영향도 새로고침" :disabled="loading" @click="load"><RefreshCw :size="14"/></button>
    </div>
    <p v-if="loading && !impact" class="layer-impact-loading">분석 중...</p>
    <p v-else-if="error" class="layer-impact-error">{{ error }}</p>
    <template v-else-if="impact">
      <div class="layer-impact-metrics">
        <div><span>Upstream</span><b>{{ impact.upstream_layers.length }}</b></div>
        <div><span>Downstream</span><b>{{ impact.downstream_layers.length }}</b></div>
        <div><span>Overlay Key</span><b>{{ impact.overlay_key_count }}</b></div>
        <div><span>Export 행</span><b>{{ impact.export_row_count }}</b></div>
      </div>
      <div v-if="impact.upstream_layers.length" class="layer-impact-path"><span><ArrowUp :size="12"/> Upstream</span><button v-for="row in impact.upstream_layers" :key="row.id" @click="selectLayer(row)">{{ row.name }}</button></div>
      <div v-if="impact.downstream_layers.length" class="layer-impact-path"><span><ArrowDown :size="12"/> Downstream</span><button v-for="row in impact.downstream_layers" :key="row.id" @click="selectLayer(row)">{{ row.name }}</button></div>
      <details v-if="impact.validation_rules.length" class="layer-impact-rules"><summary>영향받는 검증 규칙 {{ impact.validation_rules.length }}개</summary><p v-for="rule in impact.validation_rules" :key="rule.id"><b :class="rule.severity">{{ rule.severity === 'error' ? '오류' : '경고' }}</b>{{ rule.name }}</p></details>
      <p v-if="impact.attachment_relations.length" class="layer-impact-warning">삭제하면 attachment {{ impact.attachment_relations.length }}개의 연결 대상이 해제됩니다.</p>
    </template>
  </section>
</template>
