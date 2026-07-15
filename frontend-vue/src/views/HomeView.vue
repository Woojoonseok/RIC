<script setup lang="ts">
import { ref } from "vue";
import { useEditorStore } from "../stores/editor";
import { api } from "../api/client";
const store = useEditorStore();
const name = ref("");
async function createProject() {
  if (!name.value.trim()) return;
  const project = await store.run("프로젝트 생성", () => api.createProject({ name: name.value.trim() }));
  name.value = ""; await store.loadProjects(); await store.loadGraph(project.id); store.view = "editor";
}
</script>
<template>
  <section class="page home-page">
    <div class="hero-card">
      <p class="eyebrow">RIC · ALIGN ENGINEERING</p>
      <h1>공정 관계를 명확한<br><span>Align Tree</span>로 설계하세요.</h1>
      <p>Layer 데이터부터 관계 검증, 편집과 산출물까지 하나의 작업공간에서 관리합니다.</p>
      <div class="create-project"><input v-model="name" placeholder="새 프로젝트 이름" @keydown.enter="createProject"><button class="primary" @click="createProject">프로젝트 시작</button></div>
    </div>
    <div class="recent-card panel">
      <div class="panel-heading"><div><p class="eyebrow">RECENT WORK</p><h2>최근 프로젝트</h2></div><button @click="store.loadProjects">새로고침</button></div>
      <button v-for="project in store.projects" :key="project.id" class="project-tile" @click="store.loadGraph(project.id).then(() => store.view = 'editor')"><strong>{{ project.name }}</strong><span>{{ project.description || '설명 없음' }}</span><small>{{ new Date(project.updated_at).toLocaleString() }}</small></button>
      <p v-if="!store.projects.length" class="empty">프로젝트를 만들어 작업을 시작하세요.</p>
    </div>
  </section>
</template>
