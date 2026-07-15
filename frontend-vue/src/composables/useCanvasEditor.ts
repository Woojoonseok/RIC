import { computed, ref } from "vue";
import { api } from "../api/client";
import { findRelationSnap, intersects, portPoint, relationGeometry, relationStroke, snap } from "../domain/geometry";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";
import type { Layout, Point, PortName, Relation, TextBox } from "../types";

export type CanvasDragState =
  | { type: "pan"; startClient: Point; origin: Point }
  | { type: "marquee"; start: Point; end: Point; additive: boolean }
  | { type: "move"; target: "layer"; id: string; start: Point; origin: Point; layout: Layout }
  | { type: "move"; target: "text"; id: string; start: Point; origin: Point; text: TextBox }
  | { type: "resize-layer"; id: string; start: Point; layout: Layout }
  | { type: "resize-text"; id: string; start: Point; text: TextBox }
  | { type: "drag-waypoint"; id: string; index: number };

export function useCanvasEditor() {
  const app = useAppStore();
  const graphStore = useGraphStore();
  const project = useProjectStore();
  const reference = useReferenceStore();
  const svg = ref<SVGSVGElement | null>(null);
  const viewBox = ref({ x: 0, y: 0, width: 1600, height: 1000 });
  const snapEnabled = ref(true);
  const query = ref("");
  const pointer = ref<Point>({ x: 0, y: 0 });
  const drag = ref<CanvasDragState | null>(null);
  const previewLayouts = ref<Record<string, Layout>>({});
  const previewTexts = ref<Record<string, TextBox>>({});
  const previewWaypoints = ref<Record<string, Point[]>>({});
  const connect = ref<null | { layerId: string; port: PortName; start: Point }>(null);
  const relationSnap = ref<ReturnType<typeof findRelationSnap>>(null);

  const graph = computed(() => graphStore.displayGraph);
  const raw = computed(() => graphStore.rawGraph);
  const layouts = computed(() => new Map(graph.value?.layouts.map((row) => [row.layer_id, previewLayouts.value[row.layer_id] ?? row]) ?? []));
  const styles = computed(() => new Map(graph.value?.styles.map((row) => [row.layer_id, row]) ?? []));
  const relationStyles = computed(() => new Map(graph.value?.relation_styles.map((row) => [row.id, row]) ?? []));
  const relations = computed(() => new Map(graph.value?.relations.map((row) => [
    row.id,
    previewWaypoints.value[row.id] ? { ...row, waypoints: previewWaypoints.value[row.id] } : row,
  ]) ?? []));
  const relationPaths = computed(() => graph.value?.relations.map((relation) => ({
    relationId: relation.id,
    points: relationGeometry(relations.value.get(relation.id)!, layouts.value, relations.value),
  })).filter((path) => path.points.length >= 2) ?? []);
  const selectedLayers = computed(() => new Set(app.selection.filter((row) => row.kind === "layer").map((row) => row.id)));
  const selectedRelation = computed(() => app.selection.find((row) => row.kind === "relation")?.id ?? null);
  const selectedTexts = computed(() => new Set(app.selection.filter((row) => row.kind === "text").map((row) => row.id)));
  const marquee = computed(() => drag.value?.type === "marquee" ? drag.value : null);
  const ports: PortName[] = ["top", "right", "bottom", "left"];
  const viewBoxString = computed(() => `${viewBox.value.x} ${viewBox.value.y} ${viewBox.value.width} ${viewBox.value.height}`);

  function clientPoint(event: PointerEvent | WheelEvent): Point {
    if (!svg.value) return { x: 0, y: 0 };
    try {
      const matrix = svg.value.getScreenCTM();
      if (matrix) {
        const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
        return { x: point.x, y: point.y };
      }
    } catch { /* fall through to viewBox conversion */ }
    const rect = svg.value.getBoundingClientRect();
    return {
      x: viewBox.value.x + (event.clientX - rect.left) / Math.max(1, rect.width) * viewBox.value.width,
      y: viewBox.value.y + (event.clientY - rect.top) / Math.max(1, rect.height) * viewBox.value.height,
    };
  }

  function capture(event: PointerEvent) {
    (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
  }

  function nodePointerDown(event: PointerEvent, id: string, resize = false) {
    if (app.mode === "connect") return;
    event.stopPropagation();
    app.select({ kind: "layer", id }, event.ctrlKey || event.metaKey || event.shiftKey);
    const layout = layouts.value.get(id);
    if (!layout) return;
    const start = clientPoint(event);
    drag.value = resize
      ? { type: "resize-layer", id, start, layout: { ...layout } }
      : { type: "move", target: "layer", id, start, origin: { x: layout.x, y: layout.y }, layout: { ...layout } };
    capture(event);
  }

  function textPointerDown(event: PointerEvent, row: TextBox, resize = false) {
    if (row.locked) return;
    event.stopPropagation();
    app.select({ kind: "text", id: row.id }, event.ctrlKey || event.metaKey || event.shiftKey);
    const start = clientPoint(event);
    drag.value = resize
      ? { type: "resize-text", id: row.id, start, text: { ...row } }
      : { type: "move", target: "text", id: row.id, start, origin: { x: row.x, y: row.y }, text: { ...row } };
    capture(event);
  }

  function canvasDown(event: PointerEvent) {
    const point = clientPoint(event);
    pointer.value = point;
    if (event.altKey || event.button === 1) {
      drag.value = { type: "pan", startClient: { x: event.clientX, y: event.clientY }, origin: { x: viewBox.value.x, y: viewBox.value.y } };
    } else if (app.mode === "text") {
      void graphStore.mutateGraph("텍스트 추가", () => api.createText(project.projectId, { text: "Text", x: point.x, y: point.y }));
    } else {
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      if (!additive) app.clearSelection();
      drag.value = { type: "marquee", start: point, end: point, additive };
    }
    capture(event);
  }

  function pointerMove(event: PointerEvent) {
    const point = clientPoint(event);
    pointer.value = point;
    if (connect.value) {
      const candidates = relationPaths.value.filter((path) => path.relationId !== selectedRelation.value);
      const threshold = 24 * viewBox.value.width / Math.max(1, svg.value?.clientWidth ?? 1600);
      relationSnap.value = findRelationSnap(point, candidates, threshold);
    }
    const active = drag.value;
    if (!active) return;
    if (active.type === "marquee") { active.end = point; return }
    if (active.type === "pan") {
      const scaleX = viewBox.value.width / Math.max(1, svg.value?.clientWidth ?? 1);
      const scaleY = viewBox.value.height / Math.max(1, svg.value?.clientHeight ?? 1);
      viewBox.value.x = active.origin.x - (event.clientX - active.startClient.x) * scaleX;
      viewBox.value.y = active.origin.y - (event.clientY - active.startClient.y) * scaleY;
      return;
    }
    if (active.type === "drag-waypoint") {
      const row = relations.value.get(active.id);
      if (!row) return;
      const next = [...(row.waypoints ?? [])];
      next[active.index] = snapEnabled.value ? { x: snap(point.x), y: snap(point.y) } : point;
      previewWaypoints.value = { ...previewWaypoints.value, [active.id]: next };
      return;
    }
    const dx = point.x - active.start.x;
    const dy = point.y - active.start.y;
    if (active.type === "move" && active.target === "layer") {
      previewLayouts.value = { ...previewLayouts.value, [active.id]: { ...active.layout, x: active.origin.x + dx, y: active.origin.y + dy } };
    } else if (active.type === "move" && active.target === "text") {
      previewTexts.value = { ...previewTexts.value, [active.id]: { ...active.text, x: active.origin.x + dx, y: active.origin.y + dy } };
    } else if (active.type === "resize-layer") {
      previewLayouts.value = { ...previewLayouts.value, [active.id]: { ...active.layout, width: Math.max(60, active.layout.width + dx), height: Math.max(36, active.layout.height + dy) } };
    } else if (active.type === "resize-text") {
      previewTexts.value = { ...previewTexts.value, [active.id]: { ...active.text, width: Math.max(40, active.text.width + dx), height: Math.max(24, active.text.height + dy) } };
    }
  }

  async function pointerUp(event: PointerEvent) {
    const point = clientPoint(event);
    if (connect.value) { await finishConnect(point); return }
    const active = drag.value;
    drag.value = null;
    if (!active || active.type === "pan") return;
    if (active.type === "marquee") {
      const bounds = {
        x: Math.min(active.start.x, active.end.x), y: Math.min(active.start.y, active.end.y),
        width: Math.abs(active.start.x - active.end.x), height: Math.abs(active.start.y - active.end.y),
      };
      if (bounds.width > 4 || bounds.height > 4) {
        const hits = graph.value?.layouts.filter((row) => intersects(bounds, row)).map((row) => ({ kind: "layer" as const, id: row.layer_id })) ?? [];
        app.selection = active.additive
          ? [...app.selection, ...hits.filter((hit) => !app.selection.some((row) => row.kind === hit.kind && row.id === hit.id))]
          : hits;
      }
      return;
    }
    if (active.type === "move" && active.target === "layer" && previewLayouts.value[active.id]) {
      const ghost = previewLayouts.value[active.id];
      previewLayouts.value = {};
      const row = { ...ghost, x: snapEnabled.value ? snap(ghost.x) : ghost.x, y: snapEnabled.value ? snap(ghost.y) : ghost.y };
      await graphStore.mutateGraph("Layer 배치 저장", () => api.batchGraph(project.projectId, { layouts: [{ layer_id: active.id, x: row.x, y: row.y }] }));
    } else if (active.type === "resize-layer" && previewLayouts.value[active.id]) {
      const ghost = previewLayouts.value[active.id];
      previewLayouts.value = {};
      const width = Math.max(60, snapEnabled.value ? snap(ghost.width) : ghost.width);
      const height = Math.max(36, snapEnabled.value ? snap(ghost.height) : ghost.height);
      await graphStore.mutateGraph("Layer 크기 저장", () => api.batchGraph(project.projectId, { layouts: [{ layer_id: active.id, width, height }] }));
    } else if (active.type === "move" && active.target === "text" && previewTexts.value[active.id]) {
      const ghost = previewTexts.value[active.id];
      previewTexts.value = {};
      await graphStore.mutateGraph("텍스트 저장", () => api.updateText(project.projectId, active.id, {
        x: snapEnabled.value ? snap(ghost.x) : ghost.x, y: snapEnabled.value ? snap(ghost.y) : ghost.y,
      }));
    } else if (active.type === "resize-text" && previewTexts.value[active.id]) {
      const ghost = previewTexts.value[active.id];
      previewTexts.value = {};
      await graphStore.mutateGraph("텍스트 크기 저장", () => api.updateText(project.projectId, active.id, {
        width: Math.max(40, snapEnabled.value ? snap(ghost.width) : ghost.width),
        height: Math.max(24, snapEnabled.value ? snap(ghost.height) : ghost.height),
      }));
    } else if (active.type === "drag-waypoint" && previewWaypoints.value[active.id]) {
      const waypoints = previewWaypoints.value[active.id];
      previewWaypoints.value = {};
      await graphStore.mutateGraph("Waypoint 저장", () => api.updateRelation(project.projectId, active.id, { waypoints }));
    }
  }

  function wheel(event: WheelEvent) {
    event.preventDefault();
    const point = clientPoint(event);
    const factor = event.deltaY > 0 ? 1.12 : 0.88;
    const width = Math.max(280, Math.min(5000, viewBox.value.width * factor));
    const height = width / (viewBox.value.width / viewBox.value.height);
    const ratioX = (point.x - viewBox.value.x) / viewBox.value.width;
    const ratioY = (point.y - viewBox.value.y) / viewBox.value.height;
    viewBox.value = { x: point.x - width * ratioX, y: point.y - height * ratioY, width, height };
  }

  function startConnect(event: PointerEvent, layerId: string, port: PortName) {
    event.stopPropagation();
    const layout = layouts.value.get(layerId);
    if (!layout) return;
    connect.value = { layerId, port, start: portPoint(layout, port) };
    pointer.value = clientPoint(event);
    capture(event);
  }

  async function finishPort(event: PointerEvent, layerId: string, port: PortName) {
    event.stopPropagation();
    if (!connect.value || connect.value.layerId === layerId) return;
    const source = connect.value;
    connect.value = null;
    relationSnap.value = null;
    await graphStore.createRelationExpanded({
      parent_layer_id: source.layerId, child_layer_id: layerId, source_port: source.port, target_port: port,
      relation_style_id: reference.selectedRelationStyleId || null,
    });
  }

  async function finishConnect(_point: Point) {
    const source = connect.value;
    const target = relationSnap.value;
    connect.value = null;
    relationSnap.value = null;
    if (source && target) await graphStore.mutateGraph("관계선 연결", () => api.createRelation(project.projectId, {
      parent_layer_id: source.layerId, child_layer_id: null, source_port: source.port,
      attached_relation_id: target.relationId, relation_style_id: reference.selectedRelationStyleId || null,
    }));
  }

  function relationPolyline(relation: Relation) {
    return relationGeometry(relations.value.get(relation.id)!, layouts.value, relations.value).map((point) => `${point.x},${point.y}`).join(" ");
  }
  function relationAppearance(relation: Relation) {
    return relationStroke(relation.relation_style_id ? relationStyles.value.get(relation.relation_style_id) : undefined);
  }
  async function addWaypoint(event: MouseEvent, relation: Relation) {
    event.stopPropagation();
    const point = clientPoint(event as unknown as PointerEvent);
    const waypoint = snapEnabled.value ? { x: snap(point.x), y: snap(point.y) } : point;
    await graphStore.mutateGraph("Waypoint 추가", () => api.updateRelation(project.projectId, relation.id, { waypoints: [...relation.waypoints, waypoint] }));
  }
  function waypointDown(event: PointerEvent, relation: Relation, index: number) {
    event.stopPropagation();
    drag.value = { type: "drag-waypoint", id: relation.id, index };
    app.select({ kind: "relation", id: relation.id });
    capture(event);
  }
  async function deleteWaypoint(event: MouseEvent, relation: Relation, index: number) {
    event.preventDefault();
    event.stopPropagation();
    await graphStore.mutateGraph("Waypoint 삭제", () => api.updateRelation(project.projectId, relation.id, {
      waypoints: relation.waypoints.filter((_point, pointIndex) => pointIndex !== index),
    }));
  }
  function focusSearch() {
    const layer = graph.value?.layers.find((row) => row.name.toLowerCase().includes(query.value.toLowerCase()));
    const layout = layer ? layouts.value.get(layer.id) : null;
    if (!layer || !layout) return;
    viewBox.value = { x: layout.x - 320, y: layout.y - 220, width: 800, height: 500 };
    app.select({ kind: "layer", id: layer.id });
  }
  async function editLayer(id: string) {
    const layer = raw.value?.layers.find((row) => row.id === id);
    if (!layer) return;
    const name = prompt("Layer 이름", layer.name);
    if (!name?.trim()) return;
    const step = prompt("Step", layer.step ?? "");
    await graphStore.mutateGraph("Layer 인라인 저장", () => api.updateLayer(project.projectId, id, { name: name.trim(), step: step?.trim() || null }));
  }
  function fit() { viewBox.value = { x: 0, y: 0, width: 1600, height: 1000 } }

  return {
    app, graphStore, project, svg, viewBox, snapEnabled, query, pointer, drag, marquee, previewLayouts, previewTexts,
    previewWaypoints, connect, relationSnap, graph, raw, layouts, styles, relationStyles, selectedLayers,
    selectedRelation, selectedTexts, ports, viewBoxString, portPoint, nodePointerDown, textPointerDown, canvasDown,
    pointerMove, pointerUp, wheel, startConnect, finishPort, relationPolyline, relationAppearance, addWaypoint,
    waypointDown, deleteWaypoint, focusSearch, editLayer, fit,
  };
}
