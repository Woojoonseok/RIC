<script setup lang="ts">
import { computed, ref } from "vue";
import { readableLayerColor } from "./propertyOptions";
import { layerMatchesQuery } from "../../domain/graph";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";
import type { Layer } from "../../types";

const app = useAppStore();
const graph = useGraphStore();
const emit = defineEmits<{ collapse: [] }>();
const query = ref("");
const layers = computed(() => graph.displayGraph?.layers.filter((row) => layerMatchesQuery(row, app.labelField, query.value)) ?? []);

function selectLayer(id: string, additive: boolean) {
  app.select({ kind: "layer", id }, additive);
  if (!additive) app.focusRequest = { layerId: id, nonce: Date.now() };
}
function selectIssue(issue: { layer_id?: string | null; relation_id?: string | null }) {
  if (issue.layer_id) selectLayer(issue.layer_id, false);
  else if (issue.relation_id) app.select({ kind: "relation", id: issue.relation_id });
}
function mergedNameLayers(layer: Layer) {
  const ids = Array.isArray(layer.metadata_json.merged_layer_ids)
    ? layer.metadata_json.merged_layer_ids.filter((id): id is string => typeof id === "string")
    : [];
  if (!ids.length) return [layer];
  return ids.flatMap((id) => {
    const member = graph.rawGraph?.layers.find((row) => row.id === id);
    return member ? [member] : [];
  });
}
</script>

<template>
  <aside class="layer-list">
    <div class="side-heading">
      <span>LAYERS</span>
      <div><b>{{ layers.length }}</b><button class="panel-collapse-button" aria-label="Layers 패널 닫기" title="Layers 패널 닫기" @click="emit('collapse')">‹</button></div>
    </div>
    <input v-model="query" class="side-search" :placeholder="app.labelField === 'step' ? 'Step 검색' : 'Layer 검색'">
    <button v-for="layer in layers" :key="layer.id" class="layer-item" :class="{ active: app.selection.some((row) => row.kind === 'layer' && row.id === layer.id) }" @click="selectLayer(layer.id, $event.ctrlKey || $event.metaKey || $event.shiftKey)">
      <span class="layer-dot"/><span><strong><template v-for="(member, index) in mergedNameLayers(layer)" :key="member.id"><span :style="{ color: readableLayerColor(member.color) }">{{ member.name }}</span><template v-if="index < mergedNameLayers(layer).length - 1"> · </template></template></strong><small>{{ layer.step || 'Layer 번호 미지정' }}</small></span><em v-if="graph.groupSizeByLayerId[layer.id]">{{ graph.groupSizeByLayerId[layer.id] }}</em>
    </button>
    <p v-if="!layers.length" class="empty">Layer가 없습니다.</p>
    <div v-if="graph.rawGraph?.validation.issues.length" class="side-validation">
      <div class="side-heading"><span>VALIDATION</span><b>{{ graph.rawGraph.validation.issues.length }}</b></div>
      <button v-for="(issue, index) in graph.rawGraph.validation.issues" :key="`${issue.code}-${index}`" :class="issue.severity" @click="selectIssue(issue)"><strong>{{ issue.code }}</strong><small>{{ issue.message }}</small></button>
    </div>
  </aside>
</template>
