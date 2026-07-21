<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const error = ref("");
const projectId = computed(() => String(route.params.projectId || ""));
const nav = computed(() => [
  { name: "project-home", label: "Project Home" },
  { name: "project-reference", label: "기준정보" },
  { name: "project-layers", label: "Layer 정보" },
  { name: "align-tree-list", label: "Align Tree List" },
  ...(project.canAdminProject ? [{ name: "project-settings", label: `Settings${project.accessRequests.filter((row) => row.status === 'pending').length ? ` (${project.accessRequests.filter((row) => row.status === 'pending').length})` : ''}` }] : []),
]);

async function load(id: string) {
  if (!id) return;
  error.value = "";
  try {
    await project.bootstrap();
    await project.selectProject(id);
    const needsMembership = route.matched.some((record) => record.meta.requiresMembership);
    const needsAdmin = route.matched.some((record) => record.meta.requiresAdmin);
    if ((needsMembership && !project.hasMembership) || (needsAdmin && !project.canAdminProject)) {
      await router.replace({ name: "project-home", params: { projectId: id } });
      return;
    }
    if (route.matched.some((record) => record.meta.projectEditor) && project.canEditProject) await project.ensureEditLease();
    if (project.canAdminProject) void project.loadMembersAndRequests();
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : String(loadError);
  }
}

watch(projectId, load, { immediate: true });
watch(() => route.name, async () => {
  if (!project.currentProject) return;
  const needsMembership = route.matched.some((record) => record.meta.requiresMembership);
  const needsAdmin = route.matched.some((record) => record.meta.requiresAdmin);
  if ((needsMembership && !project.hasMembership) || (needsAdmin && !project.canAdminProject)) await router.replace({ name: "project-home", params: { projectId: projectId.value } });
  else if (route.matched.some((record) => record.meta.projectEditor) && project.canEditProject) await project.ensureEditLease();
  else if (!route.params.treeId && project.leaseState === "held") await project.releaseLease();
});

onBeforeRouteLeave(async (to) => {
  if (String(to.params.projectId || "") !== projectId.value) {
    await project.releaseLease();
    graph.resetGraph();
    app.clearSelection();
    if (!to.params.projectId) project.clearProjectSelection();
  }
});
</script>

<template>
  <section class="project-layout">
    <header v-if="project.currentProject" class="project-context-header">
      <div class="project-breadcrumb"><RouterLink to="/">Home</RouterLink><span>›</span><strong>{{ project.currentProject.name }}</strong><b v-if="project.currentRole" class="access-badge" :class="project.currentRole">{{ project.currentRole }}</b></div>
      <nav v-if="project.hasMembership" class="project-nav" aria-label="프로젝트 메뉴">
        <RouterLink v-for="item in nav" :key="item.name" :to="{ name: item.name, params: { projectId } }">{{ item.label }}</RouterLink>
      </nav>
    </header>
    <div v-if="project.loadingProject" class="empty-page">프로젝트를 불러오는 중입니다…</div>
    <div v-else-if="error" class="empty-page"><div><strong>프로젝트를 열 수 없습니다.</strong><p>{{ error }}</p><RouterLink to="/">Home으로 돌아가기</RouterLink></div></div>
    <RouterView v-else :key="`${projectId}-${String(route.name)}`"/>
  </section>
</template>
