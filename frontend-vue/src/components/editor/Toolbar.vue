<script setup lang="ts">
import { computed, ref } from "vue";
import {
  ChevronDown,
  Circle,
  FileImage,
  Layers3,
  Link2,
  Merge,
  MoreHorizontal,
  MousePointer2,
  Palette,
  Presentation,
  Redo2,
  RefreshCw,
  Route,
  Square,
  Split,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
} from "@lucide/vue";
import { api } from "../../api/client";
import { exportPptx, exportSvg } from "../../domain/export";
import { isMergedLayer } from "../../domain/graph";
import { layerImportPositions } from "../../domain/layerMaster";
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
  const selectedPreset = reference.boxPresets.find((preset) => preset.id === reference.selectedBoxPresetId);
  const importedSize = { width: selectedPreset?.width ?? 180, height: selectedPreset?.height ?? 72 };
  const positions = layerImportPositions(
    graph.rawGraph?.layers ?? [],
    graph.rawGraph?.layouts ?? [],
    masters.length,
    app.selectedLayerIds.at(-1),
    importedSize,
    graph.rawGraph?.text_boxes ?? [],
    app.lastCanvasActivity,
  );
  await graph.mutateGraph(`Layer 정보 ${masters.length}개 가져오기`, async () => {
    let saved;
    for (const [offset, master] of masters.entries()) {
      saved = await api.createLayer(project.projectId, {
        name: master.name,
        step: master.layer_number,
        layer_master_id: master.id,
        x: positions[offset].x,
        y: positions[offset].y,
        box_preset_id: reference.selectedBoxPresetId || null,
      });
    }
    return saved;
  });
  const lastPosition = positions.at(-1);
  if (lastPosition) app.markCanvasActivity({
    x: lastPosition.x + importedSize.width / 2,
    y: lastPosition.y + importedSize.height / 2,
  });
  layerPickerOpen.value = false;
}
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
    <div class="tool-group toolbar-history" aria-label="편집 기록">
      <button class="toolbar-icon-button" :disabled="!project.canEdit || !graph.undoStack.length" title="실행 취소" aria-label="실행 취소" @click="graph.undo"><Undo2 :size="17"/></button>
      <button class="toolbar-icon-button" :disabled="!project.canEdit || !graph.redoStack.length" title="다시 실행" aria-label="다시 실행" @click="graph.redo"><Redo2 :size="17"/></button>
    </div>
    <span class="divider"/>
    <label class="toolbar-field"><span>표시</span><select v-model="app.labelField" aria-label="Layer 표시 기준"><option value="name">Layer</option><option value="step">Step</option></select></label>
    <div class="tool-group mode-switch" aria-label="Editor mode">
      <button :class="{ active: app.mode === 'select' }" title="선택" @click="app.mode = 'select'"><MousePointer2 :size="16"/><span>선택</span></button>
      <button :class="{ active: app.mode === 'connect' }" :disabled="!project.canEdit" title="연결" @click="app.mode = 'connect'"><Link2 :size="16"/><span>연결</span></button>
      <button :class="{ active: app.mode === 'text' }" :disabled="!project.canEdit" title="텍스트" @click="app.mode = 'text'"><Type :size="16"/><span>텍스트</span></button>
      <button :class="{ active: app.mode === 'shape-rectangle' }" :disabled="!project.canEdit" title="배경 사각형" @click="app.mode = 'shape-rectangle'"><Square :size="16"/><span>사각형</span></button>
      <button :class="{ active: app.mode === 'shape-ellipse' }" :disabled="!project.canEdit" title="배경 원" @click="app.mode = 'shape-ellipse'"><Circle :size="16"/><span>원</span></button>
    </div>
    <span class="divider"/>
    <div class="tool-group legend-switches" aria-label="기준정보 표시">
      <button :class="{ active: app.showBoxPresetLegend }" title="Box Preset 표시" @click="app.setLegendVisibility('box', !app.showBoxPresetLegend)"><Palette :size="16"/><span>Box Preset</span></button>
      <button :class="{ active: app.showArrowLegend }" title="Arrow Legend 표시" @click="app.setLegendVisibility('arrow', !app.showArrowLegend)"><Route :size="16"/><span>Arrow Legend</span></button>
    </div>
    <span class="divider"/>
    <button class="toolbar-command" :disabled="!project.canEdit" @click="layerPickerOpen = true"><Layers3 :size="16"/><span>Layer 가져오기</span></button>
    <div class="tool-group toolbar-selection-actions">
      <button :disabled="!project.canEdit || app.selectedLayerIds.length < 2" title="선택한 Layer 병합" @click="mergeSelected"><Merge :size="16"/><span>병합</span></button>
      <button v-if="splitLayerId" :disabled="!project.canEdit" title="병합 그룹 분리" @click="splitSelected"><Split :size="16"/><span>분리</span></button>
      <button class="danger toolbar-icon-button" :disabled="!project.canEdit || !app.selection.length" title="선택 항목 삭제" aria-label="선택 항목 삭제" @click="graph.deleteSelection"><Trash2 :size="17"/></button>
    </div>
    <details class="toolbar-more">
      <summary aria-label="더보기" title="더보기"><MoreHorizontal :size="18"/><ChevronDown :size="13"/></summary>
      <div>
        <button :disabled="!graph.displayGraph" @click="exportSvg(graph.displayGraph!)"><FileImage :size="15"/>SVG 내보내기</button>
        <button :disabled="!graph.displayGraph" @click="exportPptx(graph.displayGraph!)"><Presentation :size="15"/>PowerPoint 내보내기</button>
        <button :disabled="!graph.displayGraph?.layers.length" @click="selectAll"><MousePointer2 :size="15"/>전체 선택</button>
        <button :disabled="!project.canEdit" @click="graph.mutateGraph('자동 배치', () => api.autoLayout(project.projectId))"><WandSparkles :size="15"/>자동 배치</button>
        <button @click="graph.reloadGraph"><RefreshCw :size="15"/>새로고침</button>
      </div>
    </details>
  </div>
  <LayerMasterPickerModal
    :open="layerPickerOpen"
    @confirm="addLayers"
    @close="layerPickerOpen = false"
  />
</template>
