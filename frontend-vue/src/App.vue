<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useAppStore } from "./stores/app";
import { useGraphStore } from "./stores/graph";
import { useProjectStore } from "./stores/project";

const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();

function shortcuts(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    project.flushAutosave();
    return;
  }
  if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? void graph.redo() : void graph.undo() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); void graph.redo() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && app.view === "editor") {
    event.preventDefault();
    app.selection = graph.displayGraph?.layers.map((layer) => ({ kind: "layer", id: layer.id })) ?? [];
  }
  if ((event.key === "Delete" || event.key === "Backspace") && app.view === "editor" && app.selection.length && project.canEdit) {
    event.preventDefault();
    void graph.deleteSelection();
  }
}

function beforeUnload() { void project.releaseLease(true) }
onMounted(async () => {
  window.addEventListener("keydown", shortcuts);
  window.addEventListener("beforeunload", beforeUnload);
  try { await project.bootstrap() }
  catch (error) { app.status = error instanceof Error ? error.message : String(error) }
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", shortcuts);
  window.removeEventListener("beforeunload", beforeUnload);
  void project.releaseLease();
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header global-header">
      <RouterLink class="brand" to="/"><span class="brand-mark">R</span><span><strong>RIC</strong><small>PROJECT · ALIGN TREE</small></span></RouterLink>
      <div class="global-identity"><span>현재 사용자</span><strong>{{ project.session?.display_name || '사내 익명 사용자' }}</strong></div>
    </header>
    <main class="app-main"><RouterView/></main>
    <footer class="status-bar"><span :data-busy="app.busy"><i/>{{ app.status }}</span><span v-if="project.currentProjectId"><b :class="`autosave-${project.autosaveState}`">{{ project.autosaveLabel }}</b><template v-if="project.currentTree"> · {{ project.currentTree.name }}</template></span><span v-else>Vue 3 · FastAPI</span></footer>
  </div>
</template>
