import { createRouter, createWebHistory } from "vue-router";

const ProjectLayout = () => import("../layouts/ProjectLayout.vue");
const TreeWorkspaceLayout = () => import("../layouts/TreeWorkspaceLayout.vue");
const AlignTreeListView = () => import("../views/AlignTreeListView.vue");
const AlignKeyEditorView = () => import("../views/AlignKeyEditorView.vue");
const DataView = () => import("../views/DataView.vue");
const EditorView = () => import("../views/EditorView.vue");
const ExportView = () => import("../views/ExportView.vue");
const HomeView = () => import("../views/HomeView.vue");
const LayerMasterView = () => import("../views/LayerMasterView.vue");
const ProjectHomeView = () => import("../views/ProjectHomeView.vue");
const ProjectSettingsView = () => import("../views/ProjectSettingsView.vue");
const ReferenceView = () => import("../views/ReferenceView.vue");
const ValidationView = () => import("../views/ValidationView.vue");

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    {
      path: "/projects/:projectId",
      component: ProjectLayout,
      children: [
        { path: "", name: "project-home", component: ProjectHomeView },
        { path: "reference", name: "project-reference", component: ReferenceView, meta: { requiresMembership: true, projectEditor: true } },
        { path: "layers", name: "project-layers", component: LayerMasterView, meta: { requiresMembership: true, projectEditor: true } },
        { path: "align-trees", name: "align-tree-list", component: AlignTreeListView, meta: { requiresMembership: true } },
        { path: "align-key-editor", name: "align-key-editor", component: AlignKeyEditorView, meta: { requiresMembership: true, projectEditor: true } },
        { path: "settings", name: "project-settings", component: ProjectSettingsView, meta: { requiresMembership: true, requiresAdmin: true, projectEditor: true } },
        {
          path: "align-trees/:treeId",
          component: TreeWorkspaceLayout,
          meta: { requiresMembership: true },
          children: [
            { path: "", redirect: { name: "tree-editor" } },
            { path: "data", name: "tree-data", component: DataView },
            { path: "editor", name: "tree-editor", component: EditorView },
            { path: "validation", name: "tree-validation", component: ValidationView },
            { path: "export", name: "tree-export", component: ExportView },
          ],
        },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
