<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import CanvasEditor from "../components/canvas/CanvasEditor.vue";
import LayerDeleteImpactModal from "../components/editor/LayerDeleteImpactModal.vue";
import LayerList from "../components/editor/LayerList.vue";
import PropertyPanel from "../components/editor/PropertyPanel.vue";
import Toolbar from "../components/editor/Toolbar.vue";
import { useGraphStore } from "../stores/graph";

const graph = useGraphStore();
const layersOpen = ref(localStorage.getItem("ric-editor-layers-hidden") !== "1");
const propertiesOpen = ref(localStorage.getItem("ric-editor-properties-hidden") !== "1");
const propertiesExpanded = ref(false);

function closeProperties() {
  propertiesExpanded.value = false;
  propertiesOpen.value = false;
}

onMounted(() => graph.reloadGraph());
watch(layersOpen, (open) => localStorage.setItem("ric-editor-layers-hidden", open ? "0" : "1"));
watch(propertiesOpen, (open) => localStorage.setItem("ric-editor-properties-hidden", open ? "0" : "1"));
</script>

<template>
  <section v-if="graph.rawGraph" class="editor-page">
    <Toolbar/>
    <div
      class="editor-workspace"
      :class="{ 'layers-hidden': !layersOpen, 'properties-hidden': !propertiesOpen }"
    >
      <LayerList v-if="layersOpen" @collapse="layersOpen = false"/>
      <button
        v-else
        class="editor-panel-reveal reveal-layers"
        aria-label="Layers 패널 열기"
        title="Layers 패널 열기"
        @click="layersOpen = true"
      >
        <span>›</span> Layers
      </button>
      <CanvasEditor/>
      <button
        v-if="propertiesExpanded"
        class="property-workspace-backdrop"
        aria-label="배경을 눌러 확대 속성 편집 닫기"
        @click="propertiesExpanded = false"
      />
      <PropertyPanel
        v-if="propertiesOpen"
        :expanded="propertiesExpanded"
        @collapse="closeProperties"
        @toggle-expanded="propertiesExpanded = !propertiesExpanded"
      />
      <button
        v-else
        class="editor-panel-reveal reveal-properties"
        aria-label="Properties 패널 열기"
        title="Properties 패널 열기"
        @click="propertiesOpen = true"
      >
        Properties <span>‹</span>
      </button>
    </div>
    <LayerDeleteImpactModal/>
  </section>
  <section v-else class="empty-page">프로젝트를 선택하세요.</section>
</template>
