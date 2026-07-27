<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import ChangeHistoryDrawer from "../components/history/ChangeHistoryDrawer.vue";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const error = ref("");
const sidebarHidden = ref(localStorage.getItem("ric-project-sidebar-hidden") === "1");
const historyOpen = ref(false);

const projectId = computed(() => String(route.params.projectId || ""));
const treeId = computed(() => String(route.params.treeId || ""));
const projectInitial = computed(() => project.currentProject?.name.trim().charAt(0).toUpperCase() || "R");
const pendingRequests = computed(() => project.accessRequests.filter((row) => row.status === "pending").length);
const hasSidebar = computed(() => Boolean(project.currentProject && project.hasMembership));
const selectedHistoryTargetId = computed(() => {
  if (!["tree-editor", "tree-data"].includes(String(route.name)) || app.selection.length !== 1) return "";
  return app.selection[0].id;
});
const historyScope = computed(() => {
  const routeName = String(route.name);
  if (routeName === "project-reference") return { title: "기준정보 변경 이력", prefixes: ["reference."] };
  if (routeName === "project-layers") return { title: "Layer 정보 변경 이력", prefixes: ["layer_master."] };
  if (routeName === "align-tree-list") return { title: "Align Tree 변경 이력", prefixes: ["align_tree."] };
  if (routeName === "project-settings") return { title: "프로젝트 설정 변경 이력", prefixes: ["project.", "access.", "member."] };
  if (routeName === "tree-data") {
    return {
      title: selectedHistoryTargetId.value ? "선택한 Relation 변경 이력" : "Layer Relation 변경 이력",
      prefixes: ["relation."],
    };
  }
  if (routeName === "tree-editor") {
    const selectedKind = app.selection.length === 1 ? app.selection[0].kind : "";
    const label = selectedKind === "layer" ? "선택한 Layer" : selectedKind === "relation" ? "선택한 Relation" : selectedKind === "text" ? "선택한 Text Box" : "Editor";
    return {
      title: `${label} 변경 이력`,
      prefixes: ["layer.", "layers.", "layout.", "style.", "relation.", "text_box.", "graph."],
    };
  }
  if (["tree-validation", "tree-export"].includes(routeName)) {
    return { title: "Align Tree 변경 이력", prefixes: [] as string[] };
  }
  return { title: "프로젝트 전체 변경 이력", prefixes: [] as string[] };
});

const projectNav = [
  { name: "project-home", label: "Overview", icon: "OV" },
  { name: "project-reference", label: "기준정보", icon: "RF" },
  { name: "project-layers", label: "Layer 정보", icon: "LY" },
  { name: "align-tree-list", label: "Align Trees", icon: "AT" },
] as const;

const treeNav = [
  { name: "tree-data", label: "Data", icon: "DT" },
  { name: "tree-editor", label: "Editor", icon: "ED" },
  { name: "tree-validation", label: "Validation", icon: "VL" },
  { name: "tree-export", label: "Export", icon: "EX" },
] as const;

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
    if (route.matched.some((record) => record.meta.projectEditor) && project.canEditProject) {
      await project.ensureEditLease();
    }
    if (project.canAdminProject) void project.loadMembersAndRequests();
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : String(loadError);
  }
}

watch(projectId, load, { immediate: true });
watch(sidebarHidden, (hidden) => localStorage.setItem("ric-project-sidebar-hidden", hidden ? "1" : "0"));
watch(() => route.name, async () => {
  if (!project.currentProject) return;
  const needsMembership = route.matched.some((record) => record.meta.requiresMembership);
  const needsAdmin = route.matched.some((record) => record.meta.requiresAdmin);
  if ((needsMembership && !project.hasMembership) || (needsAdmin && !project.canAdminProject)) {
    await router.replace({ name: "project-home", params: { projectId: projectId.value } });
  } else if (route.matched.some((record) => record.meta.projectEditor) && project.canEditProject) {
    await project.ensureEditLease();
  } else if (!route.params.treeId && project.leaseState === "held") {
    await project.releaseLease();
  }
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
  <section
    class="project-layout"
    :class="{
      'has-project-sidebar': hasSidebar && !sidebarHidden,
      'has-project-sidebar-collapsed': hasSidebar && sidebarHidden,
    }"
  >
    <aside v-if="hasSidebar && !sidebarHidden" class="project-sidebar">
      <header class="project-sidebar-header">
        <button
          class="project-sidebar-collapse"
          aria-label="프로젝트 사이드바 닫기"
          title="프로젝트 사이드바 닫기"
          @click="sidebarHidden = true"
        >‹</button>
        <RouterLink class="back-to-projects" to="/">
          <span aria-hidden="true">‹</span>
          모든 프로젝트
        </RouterLink>
        <div class="project-sidebar-identity">
          <span class="project-avatar">{{ projectInitial }}</span>
          <div>
            <strong>{{ project.currentProject?.name }}</strong>
            <small>{{ project.currentRole }} workspace</small>
          </div>
        </div>
      </header>

      <nav class="project-sidebar-nav" aria-label="프로젝트 작업공간">
        <section class="sidebar-nav-group">
          <p class="sidebar-group-label">PROJECT</p>
          <RouterLink
            v-for="item in projectNav"
            :key="item.name"
            class="sidebar-nav-link"
            :to="{ name: item.name, params: { projectId } }"
          >
            <span class="sidebar-nav-icon">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </RouterLink>
        </section>

        <section v-if="treeId" class="sidebar-nav-group tree-nav-group">
          <div class="sidebar-group-heading">
            <p class="sidebar-group-label">CURRENT ALIGN TREE</p>
            <RouterLink :to="{ name: 'align-tree-list', params: { projectId } }">목록</RouterLink>
          </div>
          <div class="current-tree-card">
            <span class="tree-status-dot" :class="{ readonly: project.readOnly }"/>
            <div>
              <strong>{{ project.currentTree?.name || "Align Tree" }}</strong>
              <small>{{ project.readOnly ? "보기 전용" : project.autosaveLabel }}</small>
            </div>
          </div>
          <RouterLink
            v-for="item in treeNav"
            :key="item.name"
            class="sidebar-nav-link tree-nav-link"
            :to="{ name: item.name, params: { projectId, treeId } }"
          >
            <span class="sidebar-nav-icon">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </RouterLink>
        </section>
      </nav>

      <footer class="project-sidebar-footer">
        <button
          class="sidebar-nav-link sidebar-action-link"
          :class="{ active: historyOpen }"
          @click="historyOpen = !historyOpen"
        >
          <span class="sidebar-nav-icon">CH</span>
          <span>변경 이력</span>
        </button>
        <RouterLink
          v-if="project.canAdminProject"
          class="sidebar-nav-link"
          :to="{ name: 'project-settings', params: { projectId } }"
        >
          <span class="sidebar-nav-icon">ST</span>
          <span>Settings</span>
          <b v-if="pendingRequests" class="sidebar-count">{{ pendingRequests }}</b>
        </RouterLink>
        <div class="workspace-presence">
          <span :class="{ mine: project.currentProject?.locked_by_me }"/>
          <div>
            <strong>
              {{ project.currentProject?.is_locked
                ? project.currentProject.locked_by_me
                  ? "내가 편집 중"
                  : `${project.currentProject.lock_holder_display_name || "다른 사용자"} 편집 중`
                : "편집 가능" }}
            </strong>
            <small>{{ project.currentRole }} 권한</small>
          </div>
        </div>
      </footer>
    </aside>

    <aside v-if="hasSidebar && sidebarHidden" class="project-sidebar-collapsed">
      <div>
        <button
          class="project-sidebar-reveal"
          aria-label="프로젝트 사이드바 열기"
          title="프로젝트 사이드바 열기"
          @click="sidebarHidden = false"
        >
          <span>›</span>
          <b>{{ projectInitial }}</b>
        </button>
        <button
          class="collapsed-history-button"
          :class="{ active: historyOpen }"
          aria-label="변경 이력 열기"
          title="변경 이력"
          @click="historyOpen = !historyOpen"
        >CH</button>
      </div>
    </aside>

    <div class="project-layout-content">
      <ChangeHistoryDrawer
        v-if="hasSidebar && historyOpen"
        :project-id="projectId"
        :title="historyScope.title"
        :align-tree-id="treeId"
        :target-id="selectedHistoryTargetId"
        :event-prefixes="historyScope.prefixes"
        @close="historyOpen = false"
      />
      <div v-if="project.loadingProject" class="empty-page">프로젝트를 불러오는 중입니다…</div>
      <div v-else-if="error" class="empty-page">
        <div>
          <strong>프로젝트를 열 수 없습니다.</strong>
          <p>{{ error }}</p>
          <RouterLink to="/">모든 프로젝트로 돌아가기</RouterLink>
        </div>
      </div>
      <RouterView v-else :key="`${projectId}-${String(route.name)}`"/>
    </div>
  </section>
</template>
