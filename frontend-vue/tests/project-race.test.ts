import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, request } from "../src/api/client";
import { useProjectStore } from "../src/stores/project";
import type { Project } from "../src/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done });
  return { promise, resolve };
}

function project(id: string, name: string, revision = 1): Project {
  return {
    id,
    name,
    description: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    revision,
    my_role: "owner",
  };
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("project navigation races", () => {
  it("does not let a late A response overwrite the selected B project", async () => {
    const a = deferred<Project>();
    const b = deferred<Project>();
    const getProject = vi.spyOn(api, "getProject").mockImplementation((id) => id === "A" ? a.promise : b.promise);
    const store = useProjectStore();

    const selectingA = store.selectProject("A");
    await vi.waitFor(() => expect(getProject).toHaveBeenCalledWith("A"));
    const selectingB = store.selectProject("B");
    await vi.waitFor(() => expect(getProject).toHaveBeenCalledWith("B"));

    b.resolve(project("B", "Project B", 4));
    await selectingB;
    a.resolve(project("A", "Project A", 9));
    await selectingA;

    expect(store.currentProjectId).toBe("B");
    expect(store.currentProject?.name).toBe("Project B");
    expect(store.currentProject?.revision).toBe(4);
  });

  it("ignores revision headers from a project that is no longer selected", async () => {
    vi.spyOn(api, "getProject").mockResolvedValue(project("B", "Project B", 3));
    const store = useProjectStore();
    await store.selectProject("B");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(null, {
      status: 204,
      headers: { "X-Project-Revision": url.includes("/projects/B/") ? "7" : "99" },
    })));

    await request<void>("/projects/A/audit-events");
    expect(store.currentProject?.revision).toBe(3);
    await request<void>("/projects/B/audit-events");
    expect(store.currentProject?.revision).toBe(7);
  });
});
