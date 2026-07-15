<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import DataView from "./views/DataView.vue";
import EditorView from "./views/EditorView.vue";
import ExportView from "./views/ExportView.vue";
import HomeView from "./views/HomeView.vue";
import LayerMasterView from "./views/LayerMasterView.vue";
import ProjectsView from "./views/ProjectsView.vue";
import ReferenceView from "./views/ReferenceView.vue";
import ValidationView from "./views/ValidationView.vue";
import { useEditorStore } from "./stores/editor";

const store = useEditorStore();
const mainNav = [{ view: "home", label: "Home" }, { view: "reference", label: "기준정보" }, { view: "layer-master", label: "Layer 정보" }, { view: "projects", label: "Projects" }] as const;
function shortcuts(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? void store.redo() : void store.undo() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); void store.redo() }
}
onMounted(async () => { window.addEventListener("keydown", shortcuts); await store.loadProjects() });
onBeforeUnmount(() => window.removeEventListener("keydown", shortcuts));
</script>
<template><div class="app-shell"><header class="app-header"><button class="brand" @click="store.view = 'home'"><span class="brand-mark">R</span><span><strong>RIC</strong><small>ALIGN TREE EDITOR</small></span></button><nav class="main-nav"><button v-for="item in mainNav" :key="item.view" :class="{ active: store.view === item.view }" @click="store.view = item.view">{{ item.label }}</button></nav><div class="header-project"><span v-if="store.selectedProject"><i/>{{ store.selectedProject.name }}</span><select v-model="store.projectId" @change="store.loadGraph(store.projectId)"><option value="">프로젝트 선택</option><option v-for="project in store.projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></div></header><main class="app-main"><HomeView v-if="store.view === 'home'"/><ReferenceView v-else-if="store.view === 'reference'"/><LayerMasterView v-else-if="store.view === 'layer-master'"/><ProjectsView v-else-if="store.view === 'projects'"/><DataView v-else-if="store.view === 'data'"/><EditorView v-else-if="store.view === 'editor'"/><ValidationView v-else-if="store.view === 'validation'"/><ExportView v-else-if="store.view === 'export'"/></main><footer class="status-bar"><span :data-busy="store.busy"><i/>{{ store.status }}</span><span>Vue 3 · FastAPI · {{ store.graph ? `${store.graph.layers.length} Layers · ${store.graph.relations.length} Relations` : 'No project' }}</span></footer></div></template>
