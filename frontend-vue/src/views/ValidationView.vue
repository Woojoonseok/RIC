<script setup lang="ts">
import { useRouter } from "vue-router";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
const router = useRouter(); const app = useAppStore(); const graph = useGraphStore(); const project = useProjectStore();
async function validate() { if (!project.projectId) return; const report = await app.run("Validation", () => api.validate(project.projectId)); if (graph.rawGraph) graph.setGraph({ ...graph.rawGraph, validation: report }) }
async function focus(issue: { layer_id?: string | null; relation_id?: string | null }) {
  if (issue.layer_id) app.select({ kind: "layer", id: issue.layer_id });
  else if (issue.relation_id) app.select({ kind: "relation", id: issue.relation_id });
  else return;
  await router.push({ name: "tree-editor", params: { projectId: project.currentProjectId, treeId: project.currentTreeId } });
}
</script>
<template><section class="page"><div class="page-title"><div><p class="eyebrow">DESIGN INTEGRITY</p><h1>Validation</h1><p>저장된 raw graph를 서버 규칙으로 검사합니다.</p></div><button class="primary" :disabled="!project.projectId" @click="validate">검증 실행</button></div><div v-if="graph.rawGraph" class="validation-layout"><div class="panel validation-summary" :class="graph.rawGraph.validation.ok ? 'ok' : 'error'"><span>{{ graph.rawGraph.validation.ok ? '✓' : '!' }}</span><div><strong>{{ graph.rawGraph.validation.ok ? 'Graph is valid' : 'Validation failed' }}</strong><p>오류 {{ graph.rawGraph.validation.issues.filter(row => row.severity === 'error').length }} · 경고 {{ graph.rawGraph.validation.issues.filter(row => row.severity === 'warning').length }}</p></div></div><div class="panel"><button v-for="(issue, index) in graph.rawGraph.validation.issues" :key="index" class="issue-row" :class="issue.severity" @click="focus(issue)"><b>{{ issue.severity }}</b><span><strong>{{ issue.code }}</strong><small>{{ issue.message }}</small></span><em>Canvas에서 보기 →</em></button><p v-if="!graph.rawGraph.validation.issues.length" class="empty">발견된 문제가 없습니다.</p></div></div><div v-else class="empty-page">프로젝트를 선택하세요.</div></section></template>
