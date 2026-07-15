<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api/client";
import { exportExcelTemplate } from "../domain/export";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import type { LayerCreate } from "../types";

const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const projectName = ref("");

const sampleLayers: LayerCreate[] = [
  { step: "S01", name: "WL", layer_property: "Main", align: "AA01", align_side: "LEFT", x: 100, y: 120 },
  { step: "S02", name: "BL", layer_property: "Sub", align: "AA02", align_side: "RIGHT", x: 330, y: 120 },
  { step: "S03", name: "CONTACT", layer_property: "Contact", align: "AA03", align_side: "CENTER", x: 560, y: 120 },
  { step: "S04", name: "METAL", layer_property: "Route", align: "AA04", align_side: "LEFT", x: 790, y: 120 },
];
const sampleRelations = [["WL", "BL", "Align"], ["BL", "CONTACT", "Overlay"], ["CONTACT", "METAL", "Align"]] as const;

async function createProject() {
  const name = projectName.value.trim();
  if (!name) return;
  const created = await project.createProject({ name });
  projectName.value = "";
  await graph.loadGraph(created.id);
  app.view = "editor";
}

async function loadSample() {
  const created = await project.createProject({ name: "Project_A" });
  try {
    const layers = [];
    for (const layer of sampleLayers) layers.push(await api.createLayer(created.id, layer));
    const byName = new Map(layers.map((layer) => [layer.name, layer.id]));
    for (const [parent, child, relationType] of sampleRelations) {
      await api.createRelation(created.id, {
        parent_layer_id: byName.get(parent)!, child_layer_id: byName.get(child)!, relation_type: relationType,
        relation_style_id: null, source_port: "right", target_port: "left",
      });
    }
    await project.loadProjects();
    await graph.loadGraph(created.id);
    app.view = "editor";
    app.status = "샘플 프로젝트 로드 완료";
  } catch (error) {
    await graph.loadGraph(created.id);
    app.status = `샘플 일부 생성 후 실패: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function open(id: string) { await graph.loadGraph(id); app.view = "editor" }
async function remove(id: string) {
  if (!confirm("프로젝트와 모든 그래프 데이터를 삭제할까요?")) return;
  const selected = project.projectId === id;
  await project.deleteProject(id);
  if (selected) graph.setGraph(null);
}
</script>

<template>
  <section class="page">
    <div class="page-title"><div><p class="eyebrow">PROJECT LIBRARY</p><h1>Projects</h1><p>프로젝트를 만들거나 최근 작업을 다시 엽니다.</p></div></div>
    <div class="projects-layout">
      <section class="panel project-create-panel">
        <div class="panel-heading"><h2>Project</h2></div>
        <div class="project-create-row"><input v-model="projectName" placeholder="Project name" @keydown.enter="createProject"><button class="primary" :disabled="!projectName.trim()" @click="createProject">New</button></div>
        <div class="project-quick-actions"><button @click="loadSample">Load Sample</button><button @click="exportExcelTemplate">Excel Template</button></div>
      </section>
      <section class="panel project-list-panel">
        <div class="panel-heading"><h2>Recent Projects</h2><button @click="project.loadProjects">새로고침</button></div>
        <p v-if="!project.projects.length" class="empty">프로젝트가 없습니다.</p>
        <div v-for="row in project.projects" :key="row.id" class="project-row">
          <button class="project-card" :class="{ selected: row.id === project.projectId }" @click="open(row.id)"><strong>{{ row.name }}</strong><small>{{ new Date(row.updated_at).toLocaleString() }}</small></button>
          <button class="danger delete-project-btn" @click="remove(row.id)">Delete</button>
        </div>
      </section>
    </div>
  </section>
</template>
