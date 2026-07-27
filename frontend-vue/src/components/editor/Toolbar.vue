<script setup lang="ts">
import { computed } from "vue";
import { api } from "../../api/client";
import { isMergedLayer } from "../../domain/graph";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";
import { useProjectStore } from "../../stores/project";
import { useReferenceStore } from "../../stores/reference";

const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const reference = useReferenceStore();
const splitLayerId = computed(() => {
  const layerId = app.selectedSplitLayerId;
  return layerId && graph.rawGraph && isMergedLayer(graph.rawGraph, layerId) ? layerId : null;
});
async function addLayer() {
  const index = (graph.rawGraph?.layers.length ?? 0) + 1;
  await graph.mutateGraph("Layer 추가", () => api.createLayer(project.projectId, {
    name: `Layer ${index}`, x: 120 + index * 20, y: 100 + index * 20,
    box_preset_id: reference.selectedBoxPresetId || null,
  }));
}
async function addText() { await graph.mutateGraph("텍스트 추가", () => api.createText(project.projectId, { text: "Text", x: 180, y: 160 })) }
function selectAll() { app.selection = graph.displayGraph?.layers.map((layer) => ({ kind: "layer" as const, id: layer.id })) ?? [] }
async function mergeSelected() {
  const layerIds = [...app.selectedLayerIds];
  if (layerIds.length < 2) return;
  await graph.mutateGraph("Layer 병합", () => api.merge(project.projectId, { layer_ids: layerIds }));
  app.selection = [{ kind: "layer", id: graph.anchorByLayerId[layerIds[0]] ?? layerIds[0] }];
}
async function splitSelected() {
  const layerId = splitLayerId.value;
  if (!layerId) return;
  await graph.mutateGraph("Layer 분할", () => api.split(project.projectId, layerId));
  app.selection = [{ kind: "layer", id: layerId }];
}
</script>

<template>
  <div class="editor-toolbar">
    <select v-model="reference.selectedRelationStyleId" aria-label="Arrow style"><option v-for="style in reference.relationStyles" :key="style.id" :value="style.id">{{ style.name }}</option></select>
    <span class="divider"/>
    <button :disabled="!project.canEdit || !graph.undoStack.length" @click="graph.undo">Undo</button><button :disabled="!project.canEdit || !graph.redoStack.length" @click="graph.redo">Redo</button>
    <span class="divider"/>
    <select v-model="reference.selectedBoxPresetId" aria-label="Box preset"><option v-for="preset in reference.boxPresets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select>
    <label class="toolbar-field">Label<select v-model="app.labelField"><option value="name">Layer</option><option value="step">Step</option></select></label>
    <button v-for="item in (['select','connect','text'] as const)" :key="item" :class="{ active: app.mode === item }" :disabled="item !== 'select' && !project.canEdit" @click="app.mode = item">{{ item[0].toUpperCase() + item.slice(1) }}</button>
    <span class="divider"/>
    <button :disabled="!project.canEdit" @click="addLayer">Add Layer</button>
    <button :disabled="!project.canEdit" @click="addText">Add Text</button>
    <button :disabled="!graph.displayGraph?.layers.length" @click="selectAll">Select All</button>
    <button :disabled="!project.canEdit || app.selectedLayerIds.length < 2" title="선택한 Layer를 첫 번째 Layer 크기로 묶습니다" @click="mergeSelected">Merge</button>
    <button v-if="splitLayerId" :disabled="!project.canEdit" title="병합 그룹을 원래 Layer로 분리합니다" @click="splitSelected">Split</button>
    <button :disabled="!project.canEdit" @click="graph.mutateGraph('자동 배치', () => api.autoLayout(project.projectId))">Auto Layout</button>
    <button class="danger" :disabled="!project.canEdit || !app.selection.length" @click="graph.deleteSelection">Delete</button>
    <button @click="graph.reloadGraph">Refresh</button>
  </div>
</template>
