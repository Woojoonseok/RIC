<script setup lang="ts">
import CanvasEditor from "../components/canvas/CanvasEditor.vue";
import LayerList from "../components/editor/LayerList.vue";
import PropertyPanel from "../components/editor/PropertyPanel.vue";
import Toolbar from "../components/editor/Toolbar.vue";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
const app = useAppStore();
const graph = useGraphStore();
</script>
<template><section v-if="graph.rawGraph" class="editor-page"><div class="workspace-tabs"><button v-for="tab in (['data','editor','validation','export'] as const)" :key="tab" :class="{ active: app.view === tab }" @click="app.view = tab">{{ tab === 'data' ? 'Data' : tab === 'editor' ? 'Editor' : tab === 'validation' ? 'Validation' : 'Export' }}</button><span>{{ graph.rawGraph.project.name }}</span></div><Toolbar/><div class="editor-workspace"><LayerList/><CanvasEditor/><PropertyPanel/></div></section><section v-else class="empty-page">프로젝트를 선택하세요.</section></template>
