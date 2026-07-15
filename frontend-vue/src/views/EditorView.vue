<script setup lang="ts">
import CanvasEditor from "../components/canvas/CanvasEditor.vue";
import LayerList from "../components/editor/LayerList.vue";
import PropertyPanel from "../components/editor/PropertyPanel.vue";
import Toolbar from "../components/editor/Toolbar.vue";
import { useGraphStore } from "../stores/graph";

const graph = useGraphStore();
</script>

<template>
  <section v-if="graph.rawGraph" class="editor-page">
    <Toolbar/>
    <div class="editor-workspace"><LayerList/><CanvasEditor/><PropertyPanel/></div>
  </section>
  <section v-else class="empty-page">프로젝트를 선택하세요.</section>
</template>
