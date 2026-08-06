import { describe, expect, it } from "vitest";
import { isReactive, reactive } from "vue";
import { describeErrorDetail } from "../src/api/client";
import { auditActorName, auditEventChanges, auditEventTitle, isChangeAuditEvent } from "../src/domain/audit";
import { cloneJson } from "../src/domain/clone";
import { graphSvg, layerExportLabel, pptxCanvasTransform, pptxLinePosition } from "../src/domain/export";
import {
  attachmentPort, closestPointOnPath, facingPorts, getClosestPointOnSegment, intersects, orthogonalWaypoints, portHandlePoint, portPoint, relationBendWaypoints, relationGeometry, relationStroke, snap,
} from "../src/domain/geometry";
import { computeDisplayGraph, expandRelationCandidates, isMergedLayer, layerMatchesQuery, relationGroupById, relationTargetLayerId } from "../src/domain/graph";
import { filterLayerMasterRows, layerImportPositions, layerMasterBaseColumns, layerMasterColumns, layerMasterMatchesQuery, layerMasterPayload, layerMasterPriorityColumns, layerMasterRowMatchesQuery, layerMasterRows } from "../src/domain/layerMaster";
import { parseTsv } from "../src/domain/tsv";
import type { AuditEvent, Graph, Layout, Relation } from "../src/types";

const project = { id: "p", name: "P", description: null, created_at: "", updated_at: "" };
const layer = (id: string, name: string) => ({ id, project_id: "p", name, step: null, layer_property: null, align: null, align_side: null, description: null, metadata_json: {}, box_preset_id: null, pending_group: null, created_at: "", updated_at: "" });
const layout = (id: string, x: number, y = 0): Layout => ({ id: `l${id}`, project_id: "p", layer_id: id, x, y, width: 100, height: 50, z_index: 0 });
const relation = (id: string, parent: string | null, child: string | null, sameGroup: string | null = null): Relation => ({
  id, project_id: "p", parent_endpoint_type: "layer", child_endpoint_type: "layer",
  parent_layer_id: parent, child_layer_id: child,
  key_layout_type_id: null, key_drawing_type_id: null, relation_type: "parent_child", relation_style_id: null,
  parent_drawing_type_id: null, child_drawing_type_id: null, comment: null,
  key_priority: null, priority_rule: null, source_port: "right", target_port: "left",
  final_type: null, key_purpose: null, placement: null, stack_type: null,
  inregi: null, inner_size: null, outer_size: null,
  extras: [], same_group: sameGroup, attached_relation_id: null, waypoints: [],
  created_at: "", updated_at: "",
});

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

describe("change history presentation", () => {
  const event = (values: Partial<AuditEvent>): AuditEvent => ({
    id: "event",
    project_id: "p",
    event_type: "layer.updated",
    created_at: "2026-07-27T00:00:00Z",
    ...values,
  });

  it("excludes lease activity from user-facing changes", () => {
    expect(isChangeAuditEvent(event({ event_type: "lease.acquired" }))).toBe(false);
    expect(isChangeAuditEvent(event({ event_type: "project.migrated_v2" }))).toBe(false);
    expect(isChangeAuditEvent(event({
      event_type: "layer.updated",
      details_json: { before: { step: "10" }, after: { step: "20" } },
    }))).toBe(true);
    expect(isChangeAuditEvent(event({
      event_type: "layer.updated",
      details_json: { before: { step: "10" }, after: { step: "10" } },
    }))).toBe(false);
  });

  it("shows the actor and exact before/after values", () => {
    const changed = event({
      actor: { id: "user", display_name: "홍길동" },
      summary: "Updated layer Metal 1",
      details_json: {
        before: { name: "Metal 1", step: "10" },
        after: { name: "Metal 1", step: "20" },
      },
    });
    expect(auditActorName(changed)).toBe("홍길동");
    expect(auditEventTitle(changed)).toBe("Layer 정보 수정 · Metal 1");
    expect(auditEventChanges(changed)).toEqual(["Layer 번호: 10 → 20"]);
  });

  it("describes added and deleted values explicitly", () => {
    expect(auditEventChanges(event({
      event_type: "layer.created",
      details_json: { values: { name: "Metal 1", step: "10" } },
    }))).toEqual(["이름: 없음 → Metal 1", "Layer 번호: 없음 → 10"]);
    expect(auditEventChanges(event({
      event_type: "layer.deleted",
      details_json: { values: { name: "Metal 1" } },
    }))).toEqual(["이름: Metal 1 → 삭제됨"]);
  });
});

describe("shared Layer information grid", () => {
  it("searches Layer Master rows by name or decimal Layer number", () => {
    const master = { name: "Metal Layer", layer_number: "25.1" };
    expect(layerMasterMatchesQuery(master, "metal")).toBe(true);
    expect(layerMasterMatchesQuery(master, "25.1")).toBe(true);
    expect(layerMasterMatchesQuery(master, "26")).toBe(false);
  });
  it("filters Layer information across all visible columns", () => {
    const row = { name: "Metal 1", layer_number: "25.1", group: "Front", comment: "critical mask" };
    const columns = [
      { key: "name", label: "Layer 명" },
      { key: "layer_number", label: "Layer 번호" },
      { key: "group", label: "Group" },
      { key: "comment", label: "Comment" },
    ];
    expect(layerMasterRowMatchesQuery(row, columns, "25.1")).toBe(true);
    expect(layerMasterRowMatchesQuery(row, columns, "critical")).toBe(true);
    expect(layerMasterRowMatchesQuery(row, columns, "back")).toBe(false);
  });
  it("combines value filters from multiple Layer information columns", () => {
    const rows = [
      { name: "Metal 1", group: "Front", pr_type: "Positive" },
      { name: "Metal 2", group: "Back", pr_type: "Positive" },
      { name: "Via 1", group: "Front", pr_type: "Negative" },
    ];
    const columns = [{ key: "name", label: "Layer 명" }, { key: "group", label: "Group" }, { key: "pr_type", label: "PR" }];
    expect(filterLayerMasterRows(rows, columns, "", { group: ["Front"], pr_type: ["Positive"] })).toEqual([rows[0]]);
    expect(filterLayerMasterRows(rows, columns, "metal", { group: ["Front"] })).toEqual([rows[0]]);
  });
  it("stacks imported Layers near the most recently changed Layer", () => {
    const layers = [
      { id: "older", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" },
      { id: "latest", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-03T00:00:00Z" },
    ];
    const layouts = [layout("older", 100, 200), layout("latest", 600, 400)];
    expect(layerImportPositions(layers, layouts, 3)).toEqual([
      { x: 732, y: 400 },
      { x: 760, y: 428 },
      { x: 788, y: 456 },
    ]);
    expect(layerImportPositions([], [], 2)).toEqual([
      { x: 120, y: 100 },
      { x: 148, y: 128 },
    ]);
    expect(layerImportPositions(layers, layouts, 1, "older")).toEqual([
      { x: 232, y: 200 },
    ]);
    expect(layerImportPositions(layers, layouts, 1, "older", { width: 180, height: 72 }, [], { x: 900, y: 700 })).toEqual([
      { x: 932, y: 732 },
    ]);
  });
  it("moves an imported Layer stack into nearby empty canvas space", () => {
    const layers = [{ id: "anchor", created_at: "", updated_at: "" }];
    const layouts = [
      layout("anchor", 100, 100),
      { ...layout("blocker", 232, 100), width: 220, height: 180 },
    ];
    const positions = layerImportPositions(layers, layouts, 3, "anchor", { width: 180, height: 72 }, [
      { x: 200, y: 300, width: 300, height: 80 },
    ]);
    const stack = { x: positions[0].x, y: positions[0].y, width: 236, height: 128 };
    for (const obstacle of layouts) expect(intersects(stack, obstacle)).toBe(false);
    expect(intersects(stack, { x: 200, y: 300, width: 300, height: 80 })).toBe(false);
  });
  it("includes Group in the canonical Layer information format", () => {
    const layouts = [{ id: "layout", name: "Scribe", scribe_lane_rows: 2, sort_order: 0 }];
    const presets = [{ id: "preset", name: "Default", fill_color: "#fff", stroke_color: "#000", text_color: "#000", font_size: 14, width: 180, height: 72, stroke_width: 2, is_default: true, sort_order: 0 }];
    const master = { id: "master", name: "M1", layer_number: "10", mask_main_fld: null, mask_sl_fld: null, pr_wf: null, dev_wf: null, pr_type: null, light_source: null, pr_open_close: null, group: "Front", validation_rule: null, comment: null, priorities: { layout: "1" } };
    expect(layerMasterColumns(layouts, presets).map((column) => column.key)).toContain("group");
    const row = layerMasterRows([master], layouts, presets)[0];
    expect(layerMasterPayload(row, layouts)).toMatchObject({ name: "M1", group: "Front", priorities: { layout: "1" } });
    expect(layerMasterBaseColumns(presets).map((column) => column.key)).not.toContain("priority:layout");
    expect(layerMasterBaseColumns(presets).map((column) => column.key)).toContain("priority_summary");
    expect(layerMasterPriorityColumns(layouts).map((column) => column.key)).toEqual([
      "layer_number",
      "name",
      "priority:layout",
    ]);
    expect(row.priority_summary).toBe("1/1 설정");
  });
});

describe("canvas exports", () => {
  it("uses the selected Layer or Step label for PowerPoint boxes", () => {
    expect(layerExportLabel({ name: "Metal", step: "25.1" }, "name")).toBe("Metal");
    expect(layerExportLabel({ name: "Metal", step: "25.1" }, "step")).toBe("25.1");
    expect(layerExportLabel({ name: "Metal", step: "  " }, "step")).toBe("Metal");
  });

  it("renders decorative shapes behind relations and Layers", () => {
    const source = graph();
    source.text_boxes = [{
      id: "shape", project_id: "p", text: "", shape_type: "ellipse",
      x: 20, y: 30, width: 200, height: 100, text_color: "#111111", font_size: 16,
      background_color: "#eeeeee", border_color: "#999999", locked: false,
    }];
    const svg = graphSvg(source);
    expect(svg).toContain('<ellipse cx="120" cy="80" rx="100" ry="50"');
    expect(svg.indexOf("<ellipse")).toBeLessThan(svg.indexOf("<polyline"));
  });

  it("exports the complete SVG content instead of a fixed Fit viewport", () => {
    const source = graph();
    source.text_boxes = [{
      id: "outside", project_id: "p", text: "", shape_type: "rectangle",
      x: 2000, y: 1200, width: 160, height: 80, text_color: "#111111", font_size: 16,
      background_color: "#eeeeee", border_color: "#999999", locked: false,
    }];
    const svg = graphSvg(source);
    expect(svg).toContain('viewBox="-40 -40 2240 1360"');
    expect(svg).toContain('<rect x="-40" y="-40" width="2240" height="1360" fill="white"/>');
    expect(svg).not.toContain('viewBox="0 0 1600 1000"');
  });

  it("fits the complete canvas content into the PowerPoint slide", () => {
    const source = graph();
    source.layouts = [layout("a", -300, -200), layout("b", 2100, 1300)];
    source.layers = [layer("a", "A"), layer("b", "B")];
    source.relations = [{ ...relation("r", "a", "b"), waypoints: [{ x: 2600, y: 600 }] }];
    const transform = pptxCanvasTransform(source);
    expect(transform.minX).toBe(-300);
    expect(transform.minY).toBe(-200);
    expect(transform.width).toBe(2900);
    expect(transform.height).toBe(1550);
    expect(transform.offsetX).toBeCloseTo(0.35, 8);
    expect(transform.offsetY).toBeGreaterThan(0.35);
  });

  it("preserves each PowerPoint line segment direction without negative sizes", () => {
    const transform = { minX: 0, minY: 0, width: 100, height: 100, scale: 0.1, offsetX: 1, offsetY: 1 };
    expect(pptxLinePosition({ x: 80, y: 20 }, { x: 20, y: 70 }, transform)).toMatchObject({
      x: 3, y: 3, w: 6, h: 5, flipH: true, flipV: false,
    });
    expect(pptxLinePosition({ x: 20, y: 70 }, { x: 80, y: 20 }, transform)).toMatchObject({
      x: 3, y: 3, w: 6, h: 5, flipH: false, flipV: true,
    });
  });
});

describe("display graph", () => {
  it("searches the field selected for Layer labels, including decimal Step values", () => {
    const target = { name: "Metal Layer", step: "25.1" };
    expect(layerMatchesQuery(target, "step", "25.1")).toBe(true);
    expect(layerMatchesQuery(target, "step", "metal")).toBe(false);
    expect(layerMatchesQuery(target, "name", "metal")).toBe(true);
    expect(layerMatchesQuery(target, "name", "25.1")).toBe(false);
  });
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
  it("renders one representative line for duplicate parent-child relations", () => {
    const raw = graph();
    raw.relations = [
      relation("r1", "a", "c"),
      { ...relation("r2", "a", "c"), source_port: "bottom", target_port: "top" },
    ];
    const display = computeDisplayGraph(raw);
    expect(display.relations.map((row) => row.id)).toEqual(["r1"]);
    expect(raw.relations).toHaveLength(2);
    expect(relationGroupById(raw, "r2").map((row) => row.id)).toEqual(["r1", "r2"]);
  });
  it("keeps spare relations out of the editor display graph", () => {
    const raw = graph();
    raw.relations.push(
      { ...relation("layer-spare", "a", null), child_endpoint_type: "spare" },
      { ...relation("spare-layer", null, "c"), parent_endpoint_type: "spare" },
      {
        ...relation("spare-spare", null, null),
        parent_endpoint_type: "spare",
        child_endpoint_type: "spare",
      },
    );
    const display = computeDisplayGraph(raw);
    expect(display.relations.map((row) => row.id)).not.toEqual(expect.arrayContaining([
      "layer-spare",
      "spare-layer",
      "spare-spare",
    ]));
    expect(raw.relations).toHaveLength(6);
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
  it("finds the correct relation segment for waypoint insertion", () => {
    expect(closestPointOnPath({ x: 190, y: 90 }, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ])).toMatchObject({ point: { x: 190, y: 100 }, segmentIndex: 2 });
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
  it("keeps every bend orthogonal and enters through the requested target side", () => {
    const start = { x: 100, y: 40 };
    const end = { x: 300, y: 160 };
    const path = [start, ...orthogonalWaypoints(start, "right", end, "bottom"), end];
    expect(path.every((point, index) => index === 0 || point.x === path[index - 1].x || point.y === path[index - 1].y)).toBe(true);
    expect(path.at(-2)!.y).toBeGreaterThan(end.y);
  });
  it("approaches a relation segment perpendicularly from the source side", () => {
    expect(attachmentPort({ x: 200, y: 20 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 100 })).toBe("top");
    expect(attachmentPort({ x: 200, y: 180 }, { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 300, y: 100 })).toBe("bottom");
    expect(attachmentPort({ x: 20, y: 200 }, { x: 100, y: 200 }, { x: 100, y: 100 }, { x: 100, y: 300 })).toBe("left");
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
  it("uses the stored attachment waypoint as an anchor without duplicating the arrow endpoint", () => {
    const layouts = new Map([["a", layout("a", 0)], ["b", layout("b", 300)], ["c", layout("c", -200, 100)]]);
    const base = relation("base", "a", "b");
    const branch = {
      ...relation("branch", "c", "b"),
      attached_relation_id: "base",
      waypoints: [{ x: 200, y: 25 }],
    };
    const points = relationGeometry(branch, layouts, new Map([[base.id, base], [branch.id, branch]]));
    expect(points).toEqual([{ x: -100, y: 125 }, { x: 200, y: 25 }]);
    expect(points.at(-2)).not.toEqual(points.at(-1));
  });
  it("keeps an attached relation anchor hidden from bend editing", () => {
    const branch = {
      ...relation("branch", "a", "b"),
      attached_relation_id: "base",
      waypoints: [{ x: 100, y: 40 }, { x: 200, y: 80 }],
    };
    expect(relationBendWaypoints(branch)).toEqual([{ x: 100, y: 40 }]);
    expect(relationBendWaypoints(relation("plain", "a", "b"))).toEqual([]);
  });
  it("does not render unresolved or cyclic attached relations", () => {
    const layouts = new Map([["a", layout("a", 0)]]);
    const a = { ...relation("a", "a", null), attached_relation_id: "b" };
    const b = { ...relation("b", "a", null), attached_relation_id: "a" };
    expect(relationGeometry(a, layouts, new Map([["a", a], ["b", b]]))).toEqual([]);
  });
});

describe("group relation expansion", () => {
  it("blocks incoming relations to merged layers", () => {
    const raw = graph();
    expect(() => expandRelationCandidates(raw, { parent_layer_id: "d", child_layer_id: "a" })).toThrow("Merge된 Layer");
    expect(expandRelationCandidates(raw, { parent_layer_id: "a", child_layer_id: "c" }).map((row) => [row.parent_layer_id, row.child_layer_id])).toEqual([["a", "c"], ["b", "c"]]);
  });
  it("expands group to individual and blocks group to group", () => {
    const raw = graph();
    expect(expandRelationCandidates(raw, { parent_layer_id: "a", child_layer_id: "d" }).map((row) => [row.parent_layer_id, row.child_layer_id])).toEqual([["a", "d"], ["b", "d"]]);
    raw.relations.push(relation("g2", "c", "d", "H"));
    expect(() => expandRelationCandidates(raw, { parent_layer_id: "a", child_layer_id: "c" })).toThrow("Merge된 Layer");
  });
  it("removes self relations", () => expect(expandRelationCandidates(graph(), { parent_layer_id: "c", child_layer_id: "c" })).toEqual([]));
  it("resolves a relation-line connection to its final target before expanding the merged source", () => {
    const raw = graph();
    raw.relations = raw.relations.filter((row) => row.id !== "r2");
    raw.relations.push({ ...relation("branch", "d", null), attached_relation_id: "r1" });
    expect(relationTargetLayerId(raw, "r1")).toBe("c");
    expect(relationTargetLayerId(raw, "branch")).toBe("c");
    const expanded = expandRelationCandidates(raw, { parent_layer_id: "a", child_layer_id: relationTargetLayerId(raw, "r1"), attached_relation_id: "r1", waypoints: [{ x: 250, y: 25 }] });
    expect(expanded.map((row) => [row.parent_layer_id, row.child_layer_id])).toEqual([["a", "c"], ["b", "c"]]);
    expect(expanded.every((row) => row.attached_relation_id === "r1" && row.waypoints?.[0]?.x === 250)).toBe(true);
  });
});

describe("API errors and TSV", () => {
  it("describes FastAPI validation details", () => expect(describeErrorDetail([{ loc: ["body", "name"], msg: "Field required" }])).toBe("body.name: Field required"));
  it("parses pasted cells", () => expect(parseTsv("A\tB\r\nC\tD")).toEqual([["A", "B"], ["C", "D"]]));
});
