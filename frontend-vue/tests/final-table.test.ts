import { describe, expect, it } from "vitest";
import { buildFinalTable, finalTableMatrix, formatLayerNumber, openCloseMarker } from "../src/domain/finalTable";
import type { Graph, LayerMaster, Relation } from "../src/types";

const relation = (id: string, createdAt: string): Relation => ({
  id,
  project_id: "project",
  parent_endpoint_type: "layer",
  child_endpoint_type: "layer",
  parent_layer_id: "layer-38",
  child_layer_id: "layer-39",
  key_layout_type_id: "layout",
  key_drawing_type_id: "drawing",
  relation_type: "parent_child",
  relation_style_id: null,
  parent_drawing_type_id: null,
  child_drawing_type_id: null,
  comment: null,
  key_priority: null,
  priority_rule: null,
  final_type: null,
  key_purpose: null,
  placement: null,
  stack_type: null,
  inregi: null,
  inner_size: null,
  outer_size: null,
  source_port: "right",
  target_port: "left",
  extras: [],
  same_group: null,
  attached_relation_id: null,
  waypoints: [],
  created_at: createdAt,
});

const graph: Graph = {
  project: { id: "project", name: "Test", description: null, created_at: "", updated_at: "" },
  layers: [
    {
      id: "layer-39", project_id: "project", name: "L39", step: null, layer_property: null,
      align: null, align_side: null, description: null, metadata_json: {}, box_preset_id: null,
      pending_group: null, layer_master_id: "master-39",
    },
    {
      id: "layer-38", project_id: "project", name: "L38", step: null, layer_property: null,
      align: null, align_side: null, description: null, metadata_json: {}, box_preset_id: null,
      pending_group: null, layer_master_id: "master-38",
    },
  ],
  layouts: [],
  styles: [],
  box_presets: [],
  relation_styles: [],
  relations: [
    relation("relation-2", "2026-01-02"),
    relation("relation-1", "2026-01-01"),
  ],
  text_boxes: [],
  validation: { ok: true, issues: [] },
};

const masters: LayerMaster[] = [
  {
    id: "master-38", name: "L38", layer_number: "38", pr_open_close: "Open",
    mask_main_fld: null, mask_sl_fld: null, pr_wf: null, dev_wf: null, pr_type: null,
    light_source: null, group: null, validation_rule: null, comment: null, priorities: {},
  },
  {
    id: "master-39", name: "L39", layer_number: "39.0", pr_open_close: "Close",
    mask_main_fld: null, mask_sl_fld: null, pr_wf: null, dev_wf: null, pr_type: null,
    light_source: null, group: null, validation_rule: null, comment: null, priorities: {},
  },
];

describe("final table", () => {
  it("formats layer numbers and Open/Close markers", () => {
    expect(formatLayerNumber("38")).toBe("38.0");
    expect(formatLayerNumber("39.04")).toBe("39.0");
    expect(openCloseMarker("Open")).toBe("O");
    expect(openCloseMarker("Close")).toBe("X");
  });

  it("creates one row per relation with stable duplicate key names", () => {
    const table = buildFinalTable(
      graph,
      masters,
      [{ id: "layout", name: "Center", scribe_lane_rows: null, sort_order: 0 }],
      [{
        id: "drawing", symbol: "H", trench_mesa: null, key_shape: null, ri_notation: null,
        drawing_guide: null, gds_path: null, sort_order: 0,
      }],
    );
    expect(table.layers.map((layer) => [layer.number, layer.marker])).toEqual([
      ["38.0", "O"],
      ["39.0", "X"],
    ]);
    expect(table.rows.map((row) => row.keyName)).toEqual(["380to390", "380to3902"]);
    expect(table.rows[0].inner).toBe("38.0");
    expect(table.rows[0].outer).toBe("39.0");
    expect(finalTableMatrix(
      table,
      { "layer-38": "PROC-38", "layer-39": "PROC-39" },
      { "layer-38": "GDS-38", "layer-39": "GDS-39" },
      { "relation-1": { "layer-38": "CUSTOM", "layer-39": "" } },
    )).toEqual(expect.arrayContaining([
      expect.arrayContaining(["LAYER", "PROC-38", "PROC-39"]),
      expect.arrayContaining(["GDS", "GDS-38", "GDS-39"]),
    ]));
    const matrix = finalTableMatrix(
      table,
      {},
      {},
      { "relation-1": { "layer-38": "CUSTOM", "layer-39": "" } },
    );
    expect(matrix[0].slice(11, 13)).toEqual(["LAYER", ""]);
    expect(matrix[1].slice(11, 13)).toEqual(["STEP", ""]);
    expect(matrix[2].slice(11, 13)).toEqual(["GDS", ""]);
    expect(matrix[3].slice(-2)).toEqual(["38.0", "39.0"]);
    expect(matrix[4].slice(-2)).toEqual(["CUSTOM", ""]);
    expect(matrix[5].slice(-2)).toEqual(["O", "X"]);
  });

  it("creates Overlay Key rows for spare endpoints and keeps spare duplicates", () => {
    const spareGraph: Graph = {
      ...graph,
      relations: [
        { ...relation("layer-spare", "2026-01-01"), child_endpoint_type: "spare", child_layer_id: null },
        { ...relation("spare-layer", "2026-01-02"), parent_endpoint_type: "spare", parent_layer_id: null },
        {
          ...relation("spare-spare-1", "2026-01-03"),
          parent_endpoint_type: "spare",
          child_endpoint_type: "spare",
          parent_layer_id: null,
          child_layer_id: null,
        },
        {
          ...relation("spare-spare-2", "2026-01-04"),
          parent_endpoint_type: "spare",
          child_endpoint_type: "spare",
          parent_layer_id: null,
          child_layer_id: null,
        },
      ],
    };
    const table = buildFinalTable(spareGraph, masters, [], []);
    expect(table.rows.map((row) => [row.keyName, row.inner, row.outer])).toEqual([
      ["380toSPARE", "38.0", "SPARE"],
      ["SPAREto390", "SPARE", "39.0"],
      ["SPAREtoSPARE", "SPARE", "SPARE"],
      ["SPAREtoSPARE2", "SPARE", "SPARE"],
    ]);
  });

  it("falls back to the Layer name when an imported Layer lost its master id", () => {
    const restoredGraph: Graph = {
      ...graph,
      layers: graph.layers.map((row) => ({ ...row, layer_master_id: null })),
      relations: [relation("restored-relation", "2026-01-01")],
    };

    const table = buildFinalTable(restoredGraph, masters, [], []);

    expect(table.rows[0]).toMatchObject({
      keyName: "380to390",
      inner: "38.0",
      outer: "39.0",
    });
  });
});
