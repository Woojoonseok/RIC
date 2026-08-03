import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useReferenceStore } from "../src/stores/reference";
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

beforeEach(() => setActivePinia(createPinia()));

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
});
