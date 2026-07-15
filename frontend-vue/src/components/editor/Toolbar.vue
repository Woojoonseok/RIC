<script setup lang="ts">
import { api } from "../../api/client";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";
import { useProjectStore } from "../../stores/project";
import { useReferenceStore } from "../../stores/reference";
const app = useAppStore(); const graph = useGraphStore(); const project = useProjectStore(); const reference = useReferenceStore();
async function addLayer() { const index = (graph.rawGraph?.layers.length ?? 0) + 1; await graph.mutateGraph("Layer 추가", () => api.createLayer(project.projectId, { name: `Layer ${index}`, x: 120 + index * 20, y: 100 + index * 20, box_preset_id: reference.selectedBoxPresetId || null })) }
async function addText() { await graph.mutateGraph("텍스트 추가", () => api.createText(project.projectId, { text: "Text", x: 180, y: 160 })) }
async function remove() {
  for (const item of [...app.selection]) {
    if (item.kind === "layer") { const preview = await api.deletePreview(project.projectId, item.id); if (!confirm(`연결 관계 ${preview.incoming.length + preview.outgoing.length}개와 함께 삭제할까요?`)) continue; await api.deleteLayer(project.projectId, item.id) }
    if (item.kind === "relation") await api.deleteRelation(project.projectId, item.id);
    if (item.kind === "text") await api.deleteText(project.projectId, item.id);
  }
  app.clearSelection(); await graph.reloadGraph();
}
</script>
<template><div class="editor-toolbar"><div class="tool-group"><button v-for="item in (['select','connect','text'] as const)" :key="item" :class="{ active: app.mode === item }" @click="app.mode = item">{{ item === 'select' ? '선택' : item === 'connect' ? '연결' : '텍스트' }}</button></div><span class="divider"/><div class="tool-group"><button @click="addLayer">Layer 추가</button><button @click="addText">Text 추가</button><button :disabled="app.selectedLayerIds.length !== 2" @click="graph.mutateGraph('그룹 병합', () => api.merge(project.projectId, { layer_ids: app.selectedLayerIds }))">병합</button><button :disabled="!app.selectedSplitLayerId" @click="graph.mutateGraph('그룹 분할', () => api.split(project.projectId, app.selectedSplitLayerId!))">분할</button></div><span class="divider"/><div class="tool-group"><button :disabled="!graph.undoStack.length" @click="graph.undo">Undo</button><button :disabled="!graph.redoStack.length" @click="graph.redo">Redo</button><button @click="graph.mutateGraph('자동 배치', () => api.autoLayout(project.projectId))">자동 배치</button><button class="danger" :disabled="!app.selection.length" @click="remove">삭제</button></div><div class="toolbar-spacer"/><select v-model="reference.selectedRelationStyleId"><option value="">기본 화살표</option><option v-for="style in reference.relationStyles" :key="style.id" :value="style.id">{{ style.name }}</option></select><select v-model="reference.selectedBoxPresetId"><option value="">기본 Box</option><option v-for="preset in reference.boxPresets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></div></template>
