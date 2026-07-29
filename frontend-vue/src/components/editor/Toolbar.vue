<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../../api/client";
import { isMergedLayer } from "../../domain/graph";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";
import { useProjectStore } from "../../stores/project";
import { useReferenceStore } from "../../stores/reference";
import type { LayerMaster } from "../../types";
import LayerMasterPickerModal from "./LayerMasterPickerModal.vue";

const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const reference = useReferenceStore();
const layerPickerOpen = ref(false);
const splitLayerId = computed(() => {
  const layerId = app.selectedSplitLayerId;
  return layerId && graph.rawGraph && isMergedLayer(graph.rawGraph, layerId) ? layerId : null;
});
async function addLayers(masters: LayerMaster[]) {
  const startIndex = graph.rawGraph?.layers.length ?? 0;
  await graph.mutateGraph(`Layer 정보 ${masters.length}개 가져오기`, async () => {
    let saved;
    for (const [offset, master] of masters.entries()) {
      const index = startIndex + offset;
      saved = await api.createLayer(project.projectId, {
        name: master.name,
        step: master.layer_number,
        layer_master_id: master.id,
        x: 120 + (index % 5) * 220,
        y: 100 + Math.floor(index / 5) * 130,
        box_preset_id: reference.selectedBoxPresetId || null,
      });
    }
    return saved;
  });
  layerPickerOpen.value = false;
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
    <select v-model="reference.selectedRelationStyleId" class="toolbar-style-select" aria-label="Arrow style" title="연결선 스타일"><option v-for="style in reference.relationStyles" :key="style.id" :value="style.id">{{ style.name }}</option></select>
    <span class="divider"/>
    <div class="tool-group">
      <button :disabled="!project.canEdit || !graph.undoStack.length" @click="graph.undo">Undo</button>
      <button :disabled="!project.canEdit || !graph.redoStack.length" @click="graph.redo">Redo</button>
    </div>
    <span class="divider"/>
    <select v-model="reference.selectedBoxPresetId" class="toolbar-preset-select" aria-label="Box preset" title="박스 프리셋"><option v-for="preset in reference.boxPresets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select>
    <label class="toolbar-field">Label<select v-model="app.labelField"><option value="name">Layer</option><option value="step">Step</option></select></label>
    <div class="tool-group mode-switch" aria-label="Editor mode">
      <button v-for="item in (['select','connect','text'] as const)" :key="item" :class="{ active: app.mode === item }" :disabled="item !== 'select' && !project.canEdit" @click="app.mode = item">{{ item[0].toUpperCase() + item.slice(1) }}</button>
    </div>
    <span class="divider"/>
    <div class="tool-group">
      <button :disabled="!project.canEdit" @click="layerPickerOpen = true">Layer에서 가져오기</button>
      <button :disabled="!project.canEdit || app.selectedLayerIds.length < 2" title="선택한 Layer를 첫 번째 Layer 크기로 묶습니다" @click="mergeSelected">Merge</button>
      <button v-if="splitLayerId" :disabled="!project.canEdit" title="병합 그룹을 원래 Layer로 분리합니다" @click="splitSelected">Split</button>
      <button class="danger" :disabled="!project.canEdit || !app.selection.length" @click="graph.deleteSelection">Delete</button>
    </div>
    <details class="toolbar-more">
      <summary>More <span aria-hidden="true">⌄</span></summary>
      <div>
        <button :disabled="!project.canEdit" @click="addText">Add Text</button>
        <button :disabled="!graph.displayGraph?.layers.length" @click="selectAll">Select All</button>
        <button :disabled="!project.canEdit" @click="graph.mutateGraph('자동 배치', () => api.autoLayout(project.projectId))">Auto Layout</button>
        <button @click="graph.reloadGraph">Refresh</button>
      </div>
    </details>
  </div>
  <LayerMasterPickerModal
    :open="layerPickerOpen"
    @confirm="addLayers"
    @close="layerPickerOpen = false"
  />
</template>
