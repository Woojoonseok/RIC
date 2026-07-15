<script setup lang="ts">
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";

const app = useAppStore();
const graph = useGraphStore();
const tabs = ["data", "editor", "validation", "export"] as const;
</script>

<template>
  <nav class="workspace-tabs" aria-label="Project workspace">
    <button v-for="tab in tabs" :key="tab" :class="{ active: app.view === tab }" @click="app.view = tab">
      {{ tab === "data" ? "Data" : tab === "editor" ? "Editor" : tab === "validation" ? "Validation" : "Export" }}
    </button>
    <span>{{ graph.rawGraph?.project.name || "프로젝트를 선택하세요" }}</span>
  </nav>
</template>
