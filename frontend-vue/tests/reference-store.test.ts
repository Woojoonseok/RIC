import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";
import { useReferenceStore } from "../src/stores/reference";
import { useProjectStore } from "../src/stores/project";
import type { KeyLayoutType, LayerMaster } from "../src/types";

function layer(id: string, name: string): LayerMaster {
  return {
    id,
    name,
    layer_number: null,
    mask_main_fld: null,
    mask_sl_fld: null,
    pr_wf: null,
    dev_wf: null,
    pr_type: null,
    light_source: null,
    pr_open_close: null,
    group: null,
    validation_rule: null,
    comment: null,
    priorities: {},
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done });
  return { promise, resolve };
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

describe("Layer Master ordering", () => {
  it("keeps existing rows in place and appends a newly saved row", () => {
    const store = useReferenceStore();
    store.layerMasters = [layer("1", "Layer 1"), layer("2", "Layer 2")];

    store.syncLayerMaster(layer("1", "Layer 1 edited"));
    store.syncLayerMaster(layer("3", "Layer 3"));

    expect(store.layerMasters.map((row) => row.id)).toEqual(["1", "2", "3"]);
    expect(store.layerMasters[0].name).toBe("Layer 1 edited");
  });
});

describe("Reference ordering", () => {
  it("appends a newly saved reference row without moving existing rows", () => {
    const store = useReferenceStore();
    const layout = (id: string, name: string): KeyLayoutType => ({
      id, name, scribe_lane_rows: null, sort_order: 0,
    });
    store.keyLayoutTypes = [layout("1", "Layout 1"), layout("2", "Layout 2")];

    store.syncReferenceRow("key-layout-types", layout("1", "Layout 1 edited"));
    store.syncReferenceRow("key-layout-types", layout("3", "Layout 3"));

    expect(store.keyLayoutTypes.map((row) => row.id)).toEqual(["1", "2", "3"]);
    expect(store.keyLayoutTypes[0].name).toBe("Layout 1 edited");
  });

  it("does not let a late project response replace the current project's references", async () => {
    const oldMasters = deferred<LayerMaster[]>();
    const newMasters = deferred<LayerMaster[]>();
    const project = useProjectStore();
    const store = useReferenceStore();
    vi.spyOn(api, "keyLayoutTypes").mockResolvedValue([]);
    vi.spyOn(api, "keyDrawingTypes").mockResolvedValue([]);
    vi.spyOn(api, "keyShapes").mockResolvedValue([]);
    vi.spyOn(api, "relationStyles").mockResolvedValue([]);
    vi.spyOn(api, "boxPresets").mockResolvedValue([]);
    vi.spyOn(api, "layerMasters").mockImplementation(() => (
      project.currentProjectId === "A" ? oldMasters.promise : newMasters.promise
    ));

    project.currentProjectId = "A";
    const loadingOld = store.loadAll();
    project.currentProjectId = "B";
    const loadingNew = store.loadAll();
    newMasters.resolve([layer("new", "Project B Layer")]);
    await loadingNew;
    oldMasters.resolve([layer("old", "Project A Layer")]);
    await loadingOld;

    expect(store.layerMasters.map((row) => row.id)).toEqual(["new"]);
  });
});
