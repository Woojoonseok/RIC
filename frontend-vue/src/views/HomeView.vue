<script setup lang="ts">
import { ref } from "vue";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const name = ref("");
async function createProject() {
  if (!name.value.trim()) return;
  const created = await project.createProject({ name: name.value.trim() });
  name.value = ""; await graph.loadGraph(created.id); app.view = "editor";
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
      <div class="panel-heading"><div><p class="eyebrow">RECENT WORK</p><h2>최근 프로젝트</h2></div><button @click="project.loadProjects">새로고침</button></div>
      <button v-for="row in project.projects" :key="row.id" class="project-tile" @click="graph.loadGraph(row.id).then(() => app.view = 'editor')"><strong>{{ row.name }}</strong><span>{{ row.description || '설명 없음' }}</span><small>{{ new Date(row.updated_at).toLocaleString() }}</small></button>
      <p v-if="!project.projects.length" class="empty">프로젝트를 만들어 작업을 시작하세요.</p>
    </div>
  </section>
</template>
