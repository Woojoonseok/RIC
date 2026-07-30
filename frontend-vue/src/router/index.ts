import { createRouter, createWebHistory } from "vue-router";
import ProjectLayout from "../layouts/ProjectLayout.vue";
import TreeWorkspaceLayout from "../layouts/TreeWorkspaceLayout.vue";
import AlignTreeListView from "../views/AlignTreeListView.vue";
import AlignKeyEditorView from "../views/AlignKeyEditorView.vue";
import DataView from "../views/DataView.vue";
import EditorView from "../views/EditorView.vue";
import ExportView from "../views/ExportView.vue";
import HomeView from "../views/HomeView.vue";
import LayerMasterView from "../views/LayerMasterView.vue";
import ProjectHomeView from "../views/ProjectHomeView.vue";
import ProjectSettingsView from "../views/ProjectSettingsView.vue";
import ReferenceView from "../views/ReferenceView.vue";
import ValidationView from "../views/ValidationView.vue";

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
        { path: "align-key-editor", name: "align-key-editor", component: AlignKeyEditorView, meta: { requiresMembership: true } },
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
