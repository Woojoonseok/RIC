<script setup lang="ts">
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
const app = useAppStore(); const graph = useGraphStore(); const project = useProjectStore();
async function remove(id: string) { if (!confirm("프로젝트와 모든 그래프 데이터를 삭제할까요?")) return; const selected = project.projectId === id; await project.deleteProject(id); if (selected) graph.setGraph(null) }
</script>
<template><section class="page"><div class="page-title"><div><p class="eyebrow">PROJECT LIBRARY</p><h1>Projects</h1></div><button @click="app.view = 'home'">새 프로젝트</button></div><div class="card-grid"><article v-for="row in project.projects" :key="row.id" class="panel project-panel"><div><strong>{{ row.name }}</strong><p>{{ row.description || '설명 없음' }}</p></div><div class="row"><button class="primary" @click="graph.loadGraph(row.id).then(() => app.view = 'editor')">열기</button><button class="danger" @click="remove(row.id)">삭제</button></div></article></div></section></template>
