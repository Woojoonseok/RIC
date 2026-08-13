import { describe, expect, it } from "vitest";
import appSource from "../src/App.vue?raw";
import apiSource from "../src/api/client.ts?raw";
import routerSource from "../src/router/index.ts?raw";
import adminViewSource from "../src/views/SystemAdminView.vue?raw";

describe("system administrator UI contract", () => {
  it("only exposes the administration link to system administrators", () => {
    expect(appSource).toContain('project.session?.is_system_admin');
    expect(appSource).toContain("최상위 관리자");
  });

  it("registers the protected administration workspace and API", () => {
    expect(routerSource).toContain('path: "/system-admin"');
    expect(adminViewSource).toContain('if (!projectStore.session?.is_system_admin)');
    expect(apiSource).toContain("/system-admin/projects");
  });

  it("requires explicit confirmation before deleting a project", () => {
    expect(adminViewSource).toContain('deleteConfirmName !== deleting.name');
    expect(adminViewSource).toContain('v-model="deleteConfirmName"');
  });
});
