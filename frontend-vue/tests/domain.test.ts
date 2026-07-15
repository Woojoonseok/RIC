import { describe, expect, it } from "vitest";
import { closestPointOnSegment, relationPoints, snap } from "../src/domain/geometry";
import { computeDisplayGraph } from "../src/domain/graph";
import { parseTsv } from "../src/domain/tsv";
import type { Graph, Layout, Relation } from "../src/types";

const project = { id: "p", name: "P", description: null, created_at: "", updated_at: "" };
function graph(): Graph {
  const layer = (id: string, name: string) => ({ id, project_id: "p", name, step: null, layer_property: null, align: null, align_side: null, description: null, metadata_json: {}, box_preset_id: null, pending_group: null, created_at: "", updated_at: "" });
  const layout = (id: string, x: number): Layout => ({ id: `l${id}`, project_id: "p", layer_id: id, x, y: 0, width: 100, height: 50, z_index: 0 });
  const relation = (id: string, parent: string, child: string, same_group: string | null = null): Relation => ({ id, project_id: "p", parent_layer_id: parent, child_layer_id: child, relation_type: "parent_child", instance: null, relation_style_id: null, source_port: "right", target_port: "left", same_group, attached_relation_id: null, waypoints: [], created_at: "", updated_at: "" });
  return { project, layers: [layer("a", "A"), layer("b", "B"), layer("c", "C")], layouts: [layout("a", 0), layout("b", 100), layout("c", 400)], styles: [], box_presets: [], relation_styles: [], relations: [relation("g", "a", "b", "1"), relation("r1", "a", "c"), relation("r2", "b", "c")], text_boxes: [], validation: { ok: true, issues: [] } };
}

describe("display graph", () => {
  it("groups without mutating the raw graph and removes duplicate displayed relations", () => {
    const raw = graph();
    const display = computeDisplayGraph(raw);
    expect(display.layers).toHaveLength(2);
    expect(display.layers[0].name).toBe("A\nB");
    expect(display.relations).toHaveLength(1);
    expect(raw.layers).toHaveLength(3);
  });
});

describe("geometry", () => {
  it("clamps projection away from segment endpoints", () => expect(closestPointOnSegment({ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }).t).toBe(0.05));
  it("guards recursive attachment cycles", () => {
    const layouts = new Map([["a", { id: "a", project_id: "p", layer_id: "a", x: 0, y: 0, width: 20, height: 20, z_index: 0 } as Layout]]);
    const a = { id: "a", project_id: "p", parent_layer_id: "a", child_layer_id: null, relation_type: "x", instance: null, relation_style_id: null, source_port: "right", target_port: "left", same_group: null, attached_relation_id: "b", waypoints: [], created_at: "", updated_at: "" } as Relation;
    const b = { ...a, id: "b", attached_relation_id: "a" };
    expect(relationPoints(a, layouts, new Map([["a", a], ["b", b]]))).toHaveLength(1);
  });
  it("snaps to a grid", () => expect(snap(31)).toBe(40));
});

describe("TSV", () => {
  it("parses pasted cells", () => expect(parseTsv("A\tB\r\nC\tD")).toEqual([["A", "B"], ["C", "D"]]));
});
