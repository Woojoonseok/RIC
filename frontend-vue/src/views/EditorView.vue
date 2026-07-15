<script setup lang="ts">
import CanvasEditor from "../components/canvas/CanvasEditor.vue";
import LayerList from "../components/editor/LayerList.vue";
import PropertyPanel from "../components/editor/PropertyPanel.vue";
import Toolbar from "../components/editor/Toolbar.vue";
import { useEditorStore } from "../stores/editor";
const store = useEditorStore();
</script>
<template><section v-if="store.graph" class="editor-page"><div class="workspace-tabs"><button v-for="tab in (['data','editor','validation','export'] as const)" :key="tab" :class="{ active: store.view === tab }" @click="store.view = tab">{{ tab === 'data' ? 'Data' : tab === 'editor' ? 'Editor' : tab === 'validation' ? 'Validation' : 'Export' }}</button><span>{{ store.graph.project.name }}</span></div><Toolbar/><div class="editor-workspace"><LayerList/><CanvasEditor/><PropertyPanel/></div></section><section v-else class="empty-page">프로젝트를 선택하세요.</section></template>
