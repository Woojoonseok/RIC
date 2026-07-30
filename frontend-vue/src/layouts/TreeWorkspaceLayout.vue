<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute } from "vue-router";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import type { AppView } from "../types";

const route = useRoute();
const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const loading = ref(false);
const error = ref("");
const treeId = computed(() => String(route.params.treeId || ""));

function syncView() {
  const map: Record<string, AppView> = {
    "tree-data": "data",
    "tree-editor": "editor",
    "tree-validation": "validation",
    "tree-export": "export",
  };
  app.view = map[String(route.name)] ?? "editor";
}

async function load(id: string) {
  if (!id) return;
  loading.value = true;
  error.value = "";
  graph.resetGraph();
  try {
    await project.bootstrap();
    await project.selectProject(String(route.params.projectId || ""));
    if (!project.hasMembership) return;
    if (!project.alignTrees.length) await project.loadAlignTrees();
    await graph.loadGraph(id);
    syncView();
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : String(loadError);
  } finally { loading.value = false }
}

async function retryEditing(force = false) {
  if (force && !confirm("다른 편집 세션을 종료하고 이 브라우저에서 편집할까요?")) return;
  const acquired = await project.ensureEditLease(force);
  if (acquired) { await graph.reloadGraph(); app.status = "편집 모드로 전환했습니다." }
}

watch(treeId, load, { immediate: true });
watch(() => route.name, syncView);
onBeforeRouteLeave(async (to) => {
  if (String(to.params.treeId || "") !== treeId.value) {
    await project.releaseLease();
    project.currentTreeId = "";
    graph.resetGraph();
  }
});
</script>

<template>
  <section class="project-workspace-shell" :class="{ 'is-read-only': project.readOnly, 'has-read-only-banner': project.readOnly }">
    <div v-if="project.readOnly" class="read-only-banner"><span><b>보기 전용</b>{{ project.readOnlyReason }}</span><div><button v-if="project.canEditProject" @click="retryEditing(false)">편집 다시 시도</button><button v-if="project.currentRole === 'owner' && project.leaseState === 'locked'" class="danger" @click="retryEditing(true)">편집 가져오기</button></div></div>
    <div v-if="loading" class="empty-page">Align Tree를 불러오는 중입니다…</div>
    <div v-else-if="error" class="empty-page"><div><strong>Align Tree를 열 수 없습니다.</strong><p>{{ error }}</p></div></div>
    <RouterView v-else/>
  </section>
</template>
