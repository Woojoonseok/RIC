<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
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
const addMenuButton = ref<HTMLButtonElement | null>(null);
const addMenuPosition = ref({ top: "0px", left: "0px" });

async function toggleAddMenu() {
  addMenuOpen.value = !addMenuOpen.value;
  if (!addMenuOpen.value) return;
  await nextTick();
  const rect = addMenuButton.value?.getBoundingClientRect();
  if (!rect) return;
  addMenuPosition.value = {
    top: `${rect.bottom + 6}px`,
    left: `${Math.max(8, Math.min(rect.right - 220, window.innerWidth - 228))}px`,
  };
}
function closeAddMenu() { addMenuOpen.value = false }
function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") closeAddMenu() }
onMounted(() => window.addEventListener("keydown", onKeyDown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeyDown));

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
async function mergeSelected() {
  const layerIds = [...app.selectedLayerIds];
  if (layerIds.length < 2) return;
  await graph.mutateGraph("Layer 병합", () => api.merge(project.projectId, { layer_ids: layerIds }));
  app.selection = [{ kind: "layer", id: graph.anchorByLayerId[layerIds[0]] ?? layerIds[0] }];
}
async function splitSelected() {
  const layerId = app.selectedSplitLayerId;
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
    <div class="add-layer-split">
      <button :disabled="!project.canEdit" @click="addLayer">Add Layer</button><button ref="addMenuButton" class="add-layer-caret" :disabled="!project.canEdit" aria-label="Add layer options" :aria-expanded="addMenuOpen" @click="toggleAddMenu">▾</button>
    </div>
    <button :disabled="!project.canEdit" @click="addText">Add Text</button>
    <button :disabled="!graph.displayGraph?.layers.length" @click="selectAll">Select All</button>
    <button :disabled="!project.canEdit || app.selectedLayerIds.length < 2" title="선택한 Layer를 첫 번째 Layer 크기로 묶습니다" @click="mergeSelected">Merge</button>
    <button :disabled="!project.canEdit || !app.selectedSplitLayerId" title="병합 그룹을 원래 Layer로 분리합니다" @click="splitSelected">Split</button>
    <button :disabled="!project.canEdit" @click="graph.mutateGraph('자동 배치', () => api.autoLayout(project.projectId))">Auto Layout</button>
    <button class="danger" :disabled="!project.canEdit || !app.selection.length" @click="graph.deleteSelection">Delete</button>
    <button @click="graph.reloadGraph">Refresh</button>
  </div>
  <Teleport to="body">
    <div v-if="addMenuOpen" class="dropdown-backdrop" @pointerdown="closeAddMenu"/>
    <div v-if="addMenuOpen" class="add-layer-menu add-layer-menu-floating" :style="addMenuPosition" role="menu">
      <button role="menuitem" :disabled="!project.canEdit" @click="addLayer(); closeAddMenu()">빈 Layer 추가</button>
      <button role="menuitem" :disabled="!project.canEdit" @click="app.layerMasterPickerOpen = true; closeAddMenu()">Layer 정보에서 가져오기</button>
    </div>
  </Teleport>
  <LayerMasterPickerModal :open="app.layerMasterPickerOpen" @close="app.layerMasterPickerOpen = false" @confirm="addLayerFromMaster"/>
</template>
