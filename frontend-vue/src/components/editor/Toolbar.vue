<script setup lang="ts">
import { ref } from "vue";
import { api } from "../../api/client";
import { cloneJson } from "../../domain/clone";
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
const addMenuOpen = ref(false);

async function addLayer() {
  const index = (graph.rawGraph?.layers.length ?? 0) + 1;
  await graph.mutateGraph("Layer 추가", () => api.createLayer(project.projectId, {
    name: `Layer ${index}`, x: 120 + index * 20, y: 100 + index * 20,
    box_preset_id: reference.selectedBoxPresetId || null,
  }));
}
async function addLayerFromMaster(master: LayerMaster) {
  app.layerMasterPickerOpen = false;
  const snapshot = cloneJson(master);
  await graph.mutateGraph("Layer 정보에서 추가", () => api.createLayer(project.projectId, {
    name: master.name,
    step: master.layer_number,
    x: 120 + (graph.rawGraph?.layers.length ?? 0) * 20,
    y: 120 + (graph.rawGraph?.layers.length ?? 0) * 20,
    box_preset_id: reference.selectedBoxPresetId || null,
    metadata_json: { layer_master: snapshot },
  }));
}
async function addText() { await graph.mutateGraph("텍스트 추가", () => api.createText(project.projectId, { text: "Text", x: 180, y: 160 })) }
function selectAll() { app.selection = graph.displayGraph?.layers.map((layer) => ({ kind: "layer" as const, id: layer.id })) ?? [] }
</script>

<template>
  <div class="editor-toolbar">
    <select v-model="reference.selectedRelationStyleId" aria-label="Arrow style"><option v-for="style in reference.relationStyles" :key="style.id" :value="style.id">{{ style.name }}</option></select>
    <span class="divider"/>
    <button :disabled="!graph.undoStack.length" @click="graph.undo">Undo</button><button :disabled="!graph.redoStack.length" @click="graph.redo">Redo</button>
    <span class="divider"/>
    <select v-model="reference.selectedBoxPresetId" aria-label="Box preset"><option v-for="preset in reference.boxPresets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select>
    <label class="toolbar-field">Label<select v-model="app.labelField"><option value="name">Layer</option><option value="step">Step</option></select></label>
    <button v-for="item in (['select','connect','text'] as const)" :key="item" :class="{ active: app.mode === item }" @click="app.mode = item">{{ item[0].toUpperCase() + item.slice(1) }}</button>
    <span class="divider"/>
    <div class="add-layer-split">
      <button @click="addLayer">Add Layer</button><button class="add-layer-caret" @click="addMenuOpen = !addMenuOpen">▾</button>
      <div v-if="addMenuOpen" class="add-layer-menu"><button @click="addLayer(); addMenuOpen = false">빈 Layer 추가</button><button @click="app.layerMasterPickerOpen = true; addMenuOpen = false">Layer정보에서 가져오기</button></div>
    </div>
    <button @click="addText">Add Text</button>
    <button :disabled="!graph.displayGraph?.layers.length" @click="selectAll">Select All</button>
    <button :disabled="app.selectedLayerIds.length < 2" @click="graph.mutateGraph('Layer 병합', () => api.merge(project.projectId, { layer_ids: app.selectedLayerIds }))">Merge</button>
    <button :disabled="!app.selectedSplitLayerId" @click="graph.mutateGraph('Layer 분할', () => api.split(project.projectId, app.selectedSplitLayerId!))">Split</button>
    <button :disabled="!project.projectId" @click="graph.mutateGraph('자동 배치', () => api.autoLayout(project.projectId))">Auto Layout</button>
    <button class="danger" :disabled="!app.selection.length" @click="graph.deleteSelection">Delete</button>
    <button @click="graph.reloadGraph">Refresh</button>
  </div>
  <LayerMasterPickerModal :open="app.layerMasterPickerOpen" @close="app.layerMasterPickerOpen = false" @confirm="addLayerFromMaster"/>
</template>
