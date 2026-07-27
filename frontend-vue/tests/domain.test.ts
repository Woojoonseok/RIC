import { describe, expect, it } from "vitest";
import { isReactive, reactive } from "vue";
import { describeErrorDetail } from "../src/api/client";
import { cloneJson } from "../src/domain/clone";
import {
  facingPorts, getClosestPointOnSegment, intersects, orthogonalWaypoints, portHandlePoint, portPoint, relationGeometry, relationStroke, snap,
} from "../src/domain/geometry";
import { computeDisplayGraph, expandRelationCandidates, isMergedLayer, relationTargetLayerId } from "../src/domain/graph";
import { layerMasterColumns, layerMasterPayload, layerMasterRows } from "../src/domain/layerMaster";
import { parseTsv } from "../src/domain/tsv";
import type { Graph, Layout, Relation } from "../src/types";

const project = { id: "p", name: "P", description: null, created_at: "", updated_at: "" };
const layer = (id: string, name: string) => ({ id, project_id: "p", name, step: null, layer_property: null, align: null, align_side: null, description: null, metadata_json: {}, box_preset_id: null, pending_group: null, created_at: "", updated_at: "" });
const layout = (id: string, x: number, y = 0): Layout => ({ id: `l${id}`, project_id: "p", layer_id: id, x, y, width: 100, height: 50, z_index: 0 });
const relation = (id: string, parent: string | null, child: string | null, sameGroup: string | null = null, instance: string | null = null): Relation => ({ id, project_id: "p", parent_layer_id: parent, child_layer_id: child, relation_type: "parent_child", instance, relation_style_id: null, source_port: "right", target_port: "left", same_group: sameGroup, attached_relation_id: null, waypoints: [], created_at: "", updated_at: "" });

function graph(): Graph {
  return {
    project,
    layers: [layer("a", "A"), layer("b", "B"), layer("c", "C"), layer("d", "D")],
    layouts: [layout("a", 0), layout("b", 100), layout("c", 400), layout("d", 700)],
    styles: [], box_presets: [], relation_styles: [],
    relations: [relation("g", "a", "b", "G"), relation("r1", "a", "c"), relation("r2", "b", "c")],
    text_boxes: [], validation: { ok: true, issues: [] },
  };
}

describe("DTO cloning", () => {
  it("clones Vue reactive graph data into a plain history snapshot", () => {
    const source = reactive(graph());
    const snapshot = cloneJson(source);
    expect(isReactive(source)).toBe(true);
    expect(isReactive(snapshot)).toBe(false);
    expect(snapshot).toEqual(graph());
  });
});

describe("shared Layer information grid", () => {
  it("includes Group in the canonical Layer information format", () => {
    const layouts = [{ id: "layout", name: "Scribe", scribe_lane_rows: 2, sort_order: 0 }];
    const presets = [{ id: "preset", name: "Default", fill_color: "#fff", stroke_color: "#000", text_color: "#000", font_size: 14, width: 180, height: 72, stroke_width: 2, is_default: true, sort_order: 0 }];
    const master = { id: "master", name: "M1", layer_number: "10", mask_main_fld: null, mask_sl_fld: null, pr_wf: null, dev_wf: null, pr_type: null, light_source: null, pr_open_close: null, group: "Front", validation_rule: null, comment: null, priorities: { layout: "1" } };
    expect(layerMasterColumns(layouts, presets).map((column) => column.key)).toContain("group");
    const row = layerMasterRows([master], layouts, presets)[0];
    expect(layerMasterPayload(row, layouts)).toMatchObject({ name: "M1", group: "Front", priorities: { layout: "1" } });
  });
});

describe("display graph", () => {
  it("recognizes only same_group members as splittable merged layers", () => {
    const raw = graph();
    expect(isMergedLayer(raw, "a")).toBe(true);
    expect(isMergedLayer(raw, "b")).toBe(true);
    expect(isMergedLayer(raw, "c")).toBe(false);
  });

  it("groups without mutating raw graph and removes duplicate display relations", () => {
    const raw = graph();
    const display = computeDisplayGraph(raw);
    expect(display.layers).toHaveLength(3);
    expect(display.layers[0].name).toBe("A\nB");
    expect(display.relations).toHaveLength(1);
    expect(display.layouts.find((row) => row.layer_id === "a")).toEqual(raw.layouts[0]);
    expect(raw.layers).toHaveLength(4);
  });
  it("keeps attached relations in the display graph", () => {
    const raw = graph();
    raw.relations.push({ ...relation("branch", "d", null), attached_relation_id: "r1" });
    const display = computeDisplayGraph(raw);
    expect(display.relations.some((row) => row.id === "branch" && row.attached_relation_id === "r1")).toBe(true);
  });
});

describe("geometry", () => {
  const box = layout("a", 20, 40);
  it("calculates ports and outward handles", () => {
    expect(portPoint(box, "right")).toEqual({ x: 120, y: 65 });
    expect(portHandlePoint(box, "right", 12)).toEqual({ x: 132, y: 65 });
  });
  it("selects facing ports from relative box positions", () => {
    const source = { x: 100, y: 100, width: 100, height: 50 };
    expect(facingPorts(source, { x: 400, y: 110, width: 100, height: 50 })).toEqual({ source: "right", target: "left" });
    expect(facingPorts(source, { x: 100, y: 400, width: 100, height: 50 })).toEqual({ source: "bottom", target: "top" });
    expect(facingPorts(source, { x: -200, y: 100, width: 100, height: 50 })).toEqual({ source: "left", target: "right" });
  });
  it("creates orthogonal waypoints for opposing and perpendicular ports", () => {
    expect(orthogonalWaypoints({ x: 100, y: 40 }, "right", { x: 300, y: 160 }, "left")).toEqual([
      { x: 200, y: 40 }, { x: 200, y: 160 },
    ]);
    expect(orthogonalWaypoints({ x: 100, y: 40 }, "right", { x: 300, y: 160 }, "top")).toEqual([
      { x: 300, y: 40 },
    ]);
    expect(orthogonalWaypoints({ x: 100, y: 40 }, "right", { x: 300, y: 40 }, "left")).toEqual([]);
  });
  it("calculates relation stroke attributes", () => {
    expect(relationStroke({ id: "s", name: "ref", stroke_color: "#123456", stroke_width: 3, line_pattern: "reference", marker_type: "none", sort_order: 0 })).toEqual({
      stroke: "#123456", strokeWidth: 3, strokeDasharray: "10 4 2 4", markerEnd: undefined,
    });
  });
  it("snaps to a grid and detects AABB intersection", () => {
    expect(snap(31)).toBe(40);
    expect(intersects({ x: 0, y: 0, width: 20, height: 20 }, { x: 15, y: 15, width: 20, height: 20 })).toBe(true);
    expect(intersects({ x: 0, y: 0, width: 20, height: 20 }, { x: 21, y: 0, width: 20, height: 20 })).toBe(false);
  });
  it("clamps segment projection to 0.05 through 0.95", () => {
    expect(getClosestPointOnSegment({ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }).t).toBe(0.05);
    expect(getClosestPointOnSegment({ x: 120, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }).t).toBe(0.95);
  });
  it("resolves attached relation geometry recursively", () => {
    const layouts = new Map([["a", layout("a", 0)], ["b", layout("b", 200)], ["c", layout("c", 400, 120)]]);
    const base = relation("base", "a", "b");
    const branch = { ...relation("branch", "c", null), attached_relation_id: "base" };
    const relations = new Map([[base.id, base], [branch.id, branch]]);
    expect(relationGeometry(branch, layouts, relations)).toHaveLength(2);
  });
  it("does not render unresolved or cyclic attached relations", () => {
    const layouts = new Map([["a", layout("a", 0)]]);
    const a = { ...relation("a", "a", null), attached_relation_id: "b" };
    const b = { ...relation("b", "a", null), attached_relation_id: "a" };
    expect(relationGeometry(a, layouts, new Map([["a", a], ["b", b]]))).toEqual([]);
  });
});

describe("group relation expansion", () => {
  it("expands individual to group and removes existing combinations", () => {
    const raw = graph();
    const expanded = expandRelationCandidates(raw, { parent_layer_id: "d", child_layer_id: "a", instance: "new" });
    expect(expanded.map((row) => row.child_layer_id)).toEqual(["a", "b"]);
    expect(expandRelationCandidates(raw, { parent_layer_id: "a", child_layer_id: "c" })).toEqual([]);
  });
  it("expands group to individual and blocks group to group", () => {
    const raw = graph();
    expect(expandRelationCandidates(raw, { parent_layer_id: "a", child_layer_id: "d", instance: "new" }).map((row) => [row.parent_layer_id, row.child_layer_id])).toEqual([["a", "d"], ["b", "d"]]);
    raw.relations.push(relation("g2", "c", "d", "H"));
    expect(() => expandRelationCandidates(raw, { parent_layer_id: "a", child_layer_id: "c" })).toThrow("그룹 간 관계");
  });
  it("removes self relations", () => expect(expandRelationCandidates(graph(), { parent_layer_id: "c", child_layer_id: "c" })).toEqual([]));
  it("resolves a relation-line connection to its final target before expanding the merged source", () => {
    const raw = graph();
    raw.relations.push({ ...relation("branch", "d", null), attached_relation_id: "r1" });
    expect(relationTargetLayerId(raw, "r1")).toBe("c");
    expect(relationTargetLayerId(raw, "branch")).toBe("c");
    const expanded = expandRelationCandidates(raw, { parent_layer_id: "a", child_layer_id: relationTargetLayerId(raw, "r1"), attached_relation_id: "r1", waypoints: [{ x: 250, y: 25 }], instance: "insert" });
    expect(expanded.map((row) => [row.parent_layer_id, row.child_layer_id])).toEqual([["a", "c"], ["b", "c"]]);
    expect(expanded.every((row) => row.attached_relation_id === "r1" && row.waypoints?.[0]?.x === 250)).toBe(true);
  });
});

describe("API errors and TSV", () => {
  it("describes FastAPI validation details", () => expect(describeErrorDetail([{ loc: ["body", "name"], msg: "Field required" }])).toBe("body.name: Field required"));
  it("parses pasted cells", () => expect(parseTsv("A\tB\r\nC\tD")).toEqual([["A", "B"], ["C", "D"]]));
});
