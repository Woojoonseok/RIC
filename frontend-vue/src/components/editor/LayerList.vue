<script setup lang="ts">
import { computed, ref } from "vue";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";

const app = useAppStore();
const graph = useGraphStore();
const emit = defineEmits<{ collapse: [] }>();
const query = ref("");
const layers = computed(() => graph.displayGraph?.layers.filter((row) => row.name.toLowerCase().includes(query.value.toLowerCase())) ?? []);

function selectLayer(id: string, additive: boolean) {
  app.select({ kind: "layer", id }, additive);
  if (!additive) app.focusRequest = { layerId: id, nonce: Date.now() };
}
function selectIssue(issue: { layer_id?: string | null; relation_id?: string | null }) {
  if (issue.layer_id) selectLayer(issue.layer_id, false);
  else if (issue.relation_id) app.select({ kind: "relation", id: issue.relation_id });
}
</script>

<template>
  <aside class="layer-list">
    <div class="side-heading">
      <span>LAYERS</span>
      <div><b>{{ layers.length }}</b><button class="panel-collapse-button" aria-label="Layers 패널 닫기" title="Layers 패널 닫기" @click="emit('collapse')">‹</button></div>
    </div>
    <input v-model="query" class="side-search" placeholder="Layer 검색">
    <button v-for="layer in layers" :key="layer.id" class="layer-item" :class="{ active: app.selection.some((row) => row.kind === 'layer' && row.id === layer.id) }" @click="selectLayer(layer.id, $event.ctrlKey || $event.metaKey || $event.shiftKey)">
      <span class="layer-dot"/><span><strong>{{ layer.name.replaceAll('\n', ' · ') }}</strong><small>{{ layer.step || 'Step 미지정' }}</small></span><em v-if="graph.groupSizeByLayerId[layer.id]">{{ graph.groupSizeByLayerId[layer.id] }}</em>
    </button>
    <p v-if="!layers.length" class="empty">Layer가 없습니다.</p>
    <div v-if="graph.rawGraph?.validation.issues.length" class="side-validation">
      <div class="side-heading"><span>VALIDATION</span><b>{{ graph.rawGraph.validation.issues.length }}</b></div>
      <button v-for="(issue, index) in graph.rawGraph.validation.issues" :key="`${issue.code}-${index}`" :class="issue.severity" @click="selectIssue(issue)"><strong>{{ issue.code }}</strong><small>{{ issue.message }}</small></button>
    </div>
  </aside>
</template>
