<script setup lang="ts">
import { api } from "../../api/client";
import { useEditorStore } from "../../stores/editor";
const store = useEditorStore();
async function addLayer() { const index = (store.graph?.layers.length ?? 0) + 1; await store.mutateGraph("Layer 추가", () => api.createLayer(store.projectId, { name: `Layer ${index}`, x: 120 + index * 20, y: 100 + index * 20, box_preset_id: store.selectedBoxPresetId || null })) }
async function addText() { await store.mutateGraph("텍스트 추가", () => api.createText(store.projectId, { text: "Text", x: 180, y: 160 })) }
async function remove() {
  for (const item of [...store.selection]) {
    if (item.kind === "layer") { const preview = await api.deletePreview(store.projectId, item.id); if (!confirm(`연결 관계 ${preview.incoming.length + preview.outgoing.length}개와 함께 삭제할까요?`)) continue; await api.deleteLayer(store.projectId, item.id) }
    if (item.kind === "relation") await api.deleteRelation(store.projectId, item.id);
    if (item.kind === "text") await api.deleteText(store.projectId, item.id);
  }
  store.selection = []; await store.loadGraph();
}
</script>
<template><div class="editor-toolbar"><div class="tool-group"><button v-for="item in (['select','connect','text'] as const)" :key="item" :class="{ active: store.mode === item }" @click="store.mode = item">{{ item === 'select' ? '선택' : item === 'connect' ? '연결' : '텍스트' }}</button></div><span class="divider"/><div class="tool-group"><button @click="addLayer">Layer 추가</button><button @click="addText">Text 추가</button><button :disabled="store.selectedLayerIds.length !== 2" @click="store.mutateGraph('그룹 병합', () => api.merge(store.projectId, store.selectedLayerIds))">병합</button><button :disabled="!store.selectedSplitLayerId" @click="store.mutateGraph('그룹 분할', () => api.split(store.projectId, store.selectedSplitLayerId!))">분할</button></div><span class="divider"/><div class="tool-group"><button :disabled="!store.undoStack.length" @click="store.undo">Undo</button><button :disabled="!store.redoStack.length" @click="store.redo">Redo</button><button @click="store.mutateGraph('자동 배치', () => api.autoLayout(store.projectId))">자동 배치</button><button class="danger" :disabled="!store.selection.length" @click="remove">삭제</button></div><div class="toolbar-spacer"/><select v-model="store.selectedRelationStyleId"><option value="">기본 화살표</option><option v-for="style in store.graph?.relation_styles" :key="style.id" :value="style.id">{{ style.name }}</option></select><select v-model="store.selectedBoxPresetId"><option value="">기본 Box</option><option v-for="preset in store.graph?.box_presets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></div></template>
