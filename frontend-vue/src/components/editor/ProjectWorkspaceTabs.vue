<script setup lang="ts">
import { useRoute } from "vue-router";
import { useProjectStore } from "../../stores/project";

const route = useRoute();
const project = useProjectStore();
const tabs = [
  { name: "tree-data", label: "Data" },
  { name: "tree-editor", label: "Editor" },
  { name: "tree-validation", label: "Validation" },
  { name: "tree-export", label: "Export" },
] as const;
</script>

<template>
  <nav class="workspace-tabs" aria-label="Align Tree workspace">
    <RouterLink v-for="tab in tabs" :key="tab.name" :to="{ name: tab.name, params: { projectId: route.params.projectId, treeId: route.params.treeId } }">{{ tab.label }}</RouterLink>
    <span><b v-if="project.readOnly" class="workspace-access-readonly">보기 전용</b>{{ project.currentTree?.name || "Align Tree" }}<em :class="`autosave-${project.autosaveState}`">{{ project.autosaveLabel }}</em></span>
  </nav>
</template>
