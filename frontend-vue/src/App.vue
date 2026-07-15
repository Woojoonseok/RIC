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
import { useAppStore } from "./stores/app";
import { useGraphStore } from "./stores/graph";
import { useProjectStore } from "./stores/project";

const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const mainNav = [{ view: "home", label: "Home" }, { view: "reference", label: "기준정보" }, { view: "layer-master", label: "Layer 정보" }, { view: "projects", label: "Projects" }] as const;
function shortcuts(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? void graph.redo() : void graph.undo() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); void graph.redo() }
}
onMounted(async () => { window.addEventListener("keydown", shortcuts); await project.loadProjects() });
onBeforeUnmount(() => window.removeEventListener("keydown", shortcuts));
</script>
<template><div class="app-shell"><header class="app-header"><button class="brand" @click="app.view = 'home'"><span class="brand-mark">R</span><span><strong>RIC</strong><small>ALIGN TREE EDITOR</small></span></button><nav class="main-nav"><button v-for="item in mainNav" :key="item.view" :class="{ active: app.view === item.view }" @click="app.view = item.view">{{ item.label }}</button></nav><div class="header-project"><span v-if="project.currentProject"><i/>{{ project.currentProject.name }}</span><select v-model="project.projectId" @change="graph.loadGraph(project.projectId)"><option value="">프로젝트 선택</option><option v-for="row in project.projects" :key="row.id" :value="row.id">{{ row.name }}</option></select></div></header><main class="app-main"><HomeView v-if="app.view === 'home'"/><ReferenceView v-else-if="app.view === 'reference'"/><LayerMasterView v-else-if="app.view === 'layer-master'"/><ProjectsView v-else-if="app.view === 'projects'"/><DataView v-else-if="app.view === 'data'"/><EditorView v-else-if="app.view === 'editor'"/><ValidationView v-else-if="app.view === 'validation'"/><ExportView v-else-if="app.view === 'export'"/></main><footer class="status-bar"><span :data-busy="app.busy"><i/>{{ app.status }}</span><span>Vue 3 · FastAPI · {{ graph.rawGraph ? `${graph.rawGraph.layers.length} Layers · ${graph.rawGraph.relations.length} Relations` : 'No project' }}</span></footer></div></template>
