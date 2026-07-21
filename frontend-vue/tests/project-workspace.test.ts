import { describe, expect, it } from "vitest";
import appSource from "../src/App.vue?raw";
import apiSource from "../src/api/client.ts?raw";
import projectStoreSource from "../src/stores/project.ts?raw";
import alignTreeListSource from "../src/views/AlignTreeListView.vue?raw";
import graphStoreSource from "../src/stores/graph.ts?raw";
import routerSource from "../src/router/index.ts?raw";
import settingsSource from "../src/views/ProjectSettingsView.vue?raw";

describe("project workspace UI contract", () => {
  it("does not expose the retired local .ricproj workflow", () => {
    const productSources = [appSource, apiSource, projectStoreSource, alignTreeListSource].join("\n");

    expect(productSources).not.toMatch(/\.ricproj/i);
    expect(productSources).not.toContain("LOCAL SNAPSHOT");
    expect(productSources).not.toMatch(/saveLocalProject|openLocalProject|replaceFromBundle|projectFile/);
  });

  it("does not expose bearer share-link creation or claiming", () => {
    const productSources = [apiSource, projectStoreSource, alignTreeListSource].join("\n");

    expect(productSources).not.toMatch(/createProjectShare|claimProjectShare|revokeProjectShare/);
    expect(productSources).not.toMatch(/shareLink|share_path|\/share\//);
    expect(alignTreeListSource).not.toMatch(/SHARE ALIGN TREE|share-create|share-dialog/);
  });

  it("keeps separate project and Align Tree selection state", () => {
    expect(projectStoreSource).toMatch(/currentProjectId/);
    expect(projectStoreSource).toMatch(/currentTreeId/);
    expect(projectStoreSource).toMatch(/alignTrees/);
  });

  it("clears tree and graph state as part of changing projects", () => {
    expect(projectStoreSource).toMatch(/selectProject/);
    expect(projectStoreSource).toMatch(/currentTreeId\.value\s*=\s*["']{2}/);
    expect(projectStoreSource).toMatch(/setGraph\(null\)|clearGraph|resetGraph/);
    expect(projectStoreSource).toMatch(/undo|resetHistory|clearHistory/);
  });

  it("ignores stale project and graph responses after navigation", () => {
    expect(projectStoreSource).toContain("projectActivationNonce");
    expect(projectStoreSource).toContain("pendingProjectLoad?.id === id");
    expect(projectStoreSource).toMatch(/nonce !== projectActivationNonce \|\| currentProjectId\.value !== id/);
    expect(graphStoreSource).toMatch(/project\.currentProjectId !== containerProjectId \|\| project\.projectId !== id/);
  });

  it("applies response revisions only to the project that issued the request", () => {
    expect(apiSource).toContain("revisionListener?.(responseProjectId, revision)");
    expect(projectStoreSource).toContain("requestProjectId === currentProjectId.value");
  });

  it("scopes user search and project metadata editing to project admins", () => {
    expect(apiSource).toContain("`/projects/${projectId}/users?query=${encodeURIComponent(query)}`");
    expect(projectStoreSource).toMatch(/!currentProjectId\.value \|\| !canAdminProject\.value/);
    expect(routerSource).toMatch(/name: "project-settings"[^\n]+requiresAdmin: true/);
    expect(settingsSource).toContain('v-if="project.canAdminProject"');
    expect(settingsSource).toMatch(/if \(!project\.canAdminProject \|\| !project\.currentProject/);
  });
});
