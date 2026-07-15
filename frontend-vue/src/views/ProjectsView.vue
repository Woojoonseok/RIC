<script setup lang="ts">
import { useEditorStore } from "../stores/editor";
import { api } from "../api/client";
const store = useEditorStore();
async function remove(id: string) { if (!confirm("프로젝트와 모든 그래프 데이터를 삭제할까요?")) return; await store.run("프로젝트 삭제", () => api.deleteProject(id)); if (store.projectId === id) { store.projectId = ""; store.setGraph(null) } await store.loadProjects() }
</script>
<template><section class="page"><div class="page-title"><div><p class="eyebrow">PROJECT LIBRARY</p><h1>Projects</h1></div><button @click="store.view = 'home'">새 프로젝트</button></div><div class="card-grid"><article v-for="project in store.projects" :key="project.id" class="panel project-panel"><div><strong>{{ project.name }}</strong><p>{{ project.description || '설명 없음' }}</p></div><div class="row"><button class="primary" @click="store.loadGraph(project.id).then(() => store.view = 'editor')">열기</button><button class="danger" @click="remove(project.id)">삭제</button></div></article></div></section></template>
