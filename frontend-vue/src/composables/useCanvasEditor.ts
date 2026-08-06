import { computed, ref, watch } from "vue";
import { api } from "../api/client";
import { attachmentPort, closestPointOnPath, facingPorts, findRelationSnap, intersects, orthogonalWaypoints, portHandlePoint, portPoint, relationBendWaypoints, relationGeometry, relationStroke, snap } from "../domain/geometry";
import { layerMatchesQuery, relationTargetLayerId } from "../domain/graph";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";
import type { CanvasObjectType, Layout, Point, PortName, Relation, TextBox } from "../types";

export type CanvasDragState =
  | { type: "pan"; startClient: Point; origin: Point }
  | { type: "marquee"; start: Point; end: Point; additive: boolean }
  | { type: "move"; start: Point; layerIds: string[]; textIds: string[]; layerOrigins: Record<string, Layout>; textOrigins: Record<string, TextBox> }
  | { type: "resize-layer"; id: string; start: Point; layout: Layout }
  | { type: "resize-text"; id: string; start: Point; text: TextBox }
  | { type: "draw-shape"; shapeType: Exclude<CanvasObjectType, "text">; start: Point; end: Point }
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
  const connect = ref<null | {
    layerId: string; port: PortName; start: Point; pointerId: number; originClient: Point; pressed: boolean; moved: boolean;
  }>(null);
  const portSnap = ref<null | { layerId: string; port: PortName; point: Point }>(null);
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
  const relationPaths = computed(() => graph.value?.relations.map((relation) => {
    const points = relationGeometry(relations.value.get(relation.id)!, layouts.value, relations.value);
    return {
      relationId: relation.id,
      relation,
      points,
      polyline: points.map((point) => `${point.x},${point.y}`).join(" "),
      appearance: relationAppearance(relation),
    };
  }).filter((path) => path.points.length >= 2) ?? []);
  const selectedLayers = computed(() => new Set(app.selection.filter((row) => row.kind === "layer").map((row) => row.id)));
  const selectedRelation = computed(() => app.selection.find((row) => row.kind === "relation")?.id ?? null);
  const selectedTexts = computed(() => new Set(app.selection.filter((row) => row.kind === "text").map((row) => row.id)));
  const marquee = computed(() => drag.value?.type === "marquee" ? drag.value : null);
  const shapePreview = computed(() => {
    const active = drag.value?.type === "draw-shape" ? drag.value : null;
    if (!active) return null;
    return {
      shapeType: active.shapeType,
      x: Math.min(active.start.x, active.end.x),
      y: Math.min(active.start.y, active.end.y),
      width: Math.abs(active.end.x - active.start.x),
      height: Math.abs(active.end.y - active.start.y),
    };
  });
  const decorativeShapes = computed(() => graph.value?.text_boxes.filter((row) => (row.shape_type ?? "text") !== "text") ?? []);
  const annotationTexts = computed(() => graph.value?.text_boxes.filter((row) => (row.shape_type ?? "text") === "text") ?? []);
  const ports: PortName[] = ["top", "right", "bottom", "left"];
  const viewBoxString = computed(() => `${viewBox.value.x} ${viewBox.value.y} ${viewBox.value.width} ${viewBox.value.height}`);

  watch(() => app.focusRequest, (request) => {
    if (!request) return;
    const layout = layouts.value.get(request.layerId);
    if (!layout) return;
    viewBox.value = { x: layout.x - 320, y: layout.y - 220, width: 800, height: 500 };
  }, { deep: true });

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
    svg.value?.setPointerCapture?.(event.pointerId);
  }

  function release(event: PointerEvent) {
    if (svg.value?.hasPointerCapture?.(event.pointerId)) svg.value.releasePointerCapture(event.pointerId);
  }

  function layerConnectionWaypoints(sourceLayerId: string, sourcePort: PortName, targetLayerId: string, targetPort: PortName, orthogonal: boolean) {
    if (!orthogonal) return undefined;
    const sourceLayout = layouts.value.get(sourceLayerId);
    const targetLayout = layouts.value.get(targetLayerId);
    if (!sourceLayout || !targetLayout) return undefined;
    return orthogonalWaypoints(portPoint(sourceLayout, sourcePort), sourcePort, portPoint(targetLayout, targetPort), targetPort);
  }

  function pointConnectionWaypoints(sourceLayerId: string, sourcePort: PortName, target: Point, targetPort: PortName, orthogonal: boolean) {
    if (!orthogonal) return [];
    const sourceLayout = layouts.value.get(sourceLayerId);
    if (!sourceLayout) return [];
    return orthogonalWaypoints(portPoint(sourceLayout, sourcePort), sourcePort, target, targetPort);
  }

  function attachmentRoute(
    sourceLayerId: string,
    sourcePort: PortName,
    target: NonNullable<ReturnType<typeof findRelationSnap>>,
  ) {
    const sourceLayout = layouts.value.get(sourceLayerId);
    const targetPath = relationPaths.value.find((path) => path.relationId === target.relationId)?.points;
    const segmentStart = targetPath?.[target.segmentIndex];
    const segmentEnd = targetPath?.[target.segmentIndex + 1];
    if (!sourceLayout || !segmentStart || !segmentEnd) return null;
    const targetPort = attachmentPort(portPoint(sourceLayout, sourcePort), target.point, segmentStart, segmentEnd);
    return {
      targetPort,
      waypoints: [
        ...pointConnectionWaypoints(sourceLayerId, sourcePort, target.point, targetPort, true),
        target.point,
      ],
    };
  }

  function nodePointerDown(event: PointerEvent, id: string, resize = false) {
    app.markCanvasActivity(clientPoint(event));
    if (app.mode === "connect") {
      event.preventDefault(); event.stopPropagation();
      if (!project.canEdit) { app.mode = "select"; return }
      const source = connect.value;
      const layout = layouts.value.get(id);
      if (!layout) return;
      if (!source) {
        const port: PortName = "right";
        connect.value = { layerId: id, port, start: portHandlePoint(layout, port), pointerId: event.pointerId, originClient: { x: event.clientX, y: event.clientY }, pressed: false, moved: false };
        app.select({ kind: "layer", id });
        app.status = "Target Layer 박스를 클릭하세요.";
      } else if (source.layerId !== id) {
        const sourceLayout = layouts.value.get(source.layerId);
        if (!sourceLayout) return;
        const ports = facingPorts(sourceLayout, layout);
        connect.value = null; portSnap.value = null; relationSnap.value = null; app.mode = "select";
        void graphStore.createRelationExpanded({
          parent_layer_id: source.layerId, child_layer_id: id, source_port: ports.source, target_port: ports.target,
          waypoints: layerConnectionWaypoints(source.layerId, ports.source, id, ports.target, event.shiftKey),
          relation_style_id: reference.selectedRelationStyleId || null,
        });
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const alreadySelected = app.selection.some((item) => item.kind === "layer" && item.id === id);
    if (!alreadySelected || additive) app.select({ kind: "layer", id }, additive);
    if (!project.canEdit) return;
    const layout = layouts.value.get(id);
    if (!layout) return;
    const start = clientPoint(event);
    if (resize) drag.value = { type: "resize-layer", id, start, layout: { ...layout } };
    else {
      const activeSelection = alreadySelected ? app.selection : additive ? [...app.selection, { kind: "layer" as const, id }] : [{ kind: "layer" as const, id }];
      const layerIds = activeSelection.filter((item) => item.kind === "layer").map((item) => item.id);
      const textIds = activeSelection.filter((item) => item.kind === "text").map((item) => item.id);
      const layerOrigins = Object.fromEntries(layerIds.flatMap((layerId) => {
        const row = layouts.value.get(layerId);
        return row ? [[layerId, { ...row }]] : [];
      }));
      const textOrigins = Object.fromEntries(textIds.flatMap((textId) => {
        const row = graph.value?.text_boxes.find((text) => text.id === textId);
        return row ? [[textId, { ...row }]] : [];
      }));
      drag.value = { type: "move", start, layerIds, textIds, layerOrigins, textOrigins };
    }
    capture(event);
  }

  function textPointerDown(event: PointerEvent, row: TextBox, resize = false) {
    app.markCanvasActivity(clientPoint(event));
    event.preventDefault();
    event.stopPropagation();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const alreadySelected = app.selection.some((item) => item.kind === "text" && item.id === row.id);
    if (!alreadySelected || additive) app.select({ kind: "text", id: row.id }, additive);
    if (!project.canEdit || row.locked) return;
    const start = clientPoint(event);
    if (resize) drag.value = { type: "resize-text", id: row.id, start, text: { ...row } };
    else {
      const activeSelection = alreadySelected ? app.selection : additive ? [...app.selection, { kind: "text" as const, id: row.id }] : [{ kind: "text" as const, id: row.id }];
      const layerIds = activeSelection.filter((item) => item.kind === "layer").map((item) => item.id);
      const textIds = activeSelection.filter((item) => item.kind === "text").map((item) => item.id);
      const layerOrigins = Object.fromEntries(layerIds.flatMap((layerId) => {
        const item = layouts.value.get(layerId);
        return item ? [[layerId, { ...item }]] : [];
      }));
      const textOrigins = Object.fromEntries(textIds.flatMap((textId) => {
        const item = graph.value?.text_boxes.find((text) => text.id === textId);
        return item ? [[textId, { ...item }]] : [];
      }));
      drag.value = { type: "move", start, layerIds, textIds, layerOrigins, textOrigins };
    }
    capture(event);
  }

  function canvasDown(event: PointerEvent) {
    event.preventDefault();
    const point = clientPoint(event);
    app.markCanvasActivity(point);
    pointer.value = point;
    if (connect.value && !connect.value.pressed) {
      connect.value = null;
      portSnap.value = null;
      relationSnap.value = null;
      app.mode = "select";
    }
    if (event.altKey || event.button === 1) {
      drag.value = { type: "pan", startClient: { x: event.clientX, y: event.clientY }, origin: { x: viewBox.value.x, y: viewBox.value.y } };
    } else if (app.mode === "shape-rectangle" || app.mode === "shape-ellipse") {
      if (!project.canEdit) { app.mode = "select"; return }
      drag.value = {
        type: "draw-shape",
        shapeType: app.mode === "shape-ellipse" ? "ellipse" : "rectangle",
        start: point,
        end: point,
      };
    } else if (app.mode === "text") {
      // Text placement is a one-shot tool. Leave text mode before starting the
      // request so additional clicks cannot enqueue duplicate text boxes.
      app.mode = "select";
      if (!project.canEdit) return;
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
      if (connect.value.pressed && event.pointerId === connect.value.pointerId) {
        const moved = Math.hypot(event.clientX - connect.value.originClient.x, event.clientY - connect.value.originClient.y) > 4;
        if (moved && !connect.value.moved) connect.value = { ...connect.value, moved: true };
      }
      const threshold = 18 * viewBox.value.width / Math.max(1, svg.value?.clientWidth ?? 1600);
      let closest: typeof portSnap.value = null;
      let closestDistance = threshold;
      for (const layer of graph.value?.layers ?? []) {
        if (layer.id === connect.value.layerId) continue;
        const layout = layouts.value.get(layer.id);
        if (!layout) continue;
        for (const port of ports) {
          const target = portHandlePoint(layout, port);
          const distance = Math.hypot(point.x - target.x, point.y - target.y);
          if (distance <= closestDistance) {
            closestDistance = distance;
            closest = { layerId: layer.id, port, point: target };
          }
        }
      }
      portSnap.value = closest;
      const candidates = relationPaths.value.filter((path) => path.relationId !== selectedRelation.value);
      relationSnap.value = closest ? null : findRelationSnap(point, candidates, threshold);
    }
    const active = drag.value;
    if (!active) return;
    if (active.type === "marquee") { active.end = point; return }
    if (active.type === "draw-shape") { active.end = point; return }
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
    if (active.type === "move") {
      previewLayouts.value = Object.fromEntries(Object.entries(active.layerOrigins).map(([id, layout]) => [id, { ...layout, x: layout.x + dx, y: layout.y + dy }]));
      previewTexts.value = Object.fromEntries(Object.entries(active.textOrigins).map(([id, text]) => [id, { ...text, x: text.x + dx, y: text.y + dy }]));
    } else if (active.type === "resize-layer") {
      previewLayouts.value = { ...previewLayouts.value, [active.id]: { ...active.layout, width: Math.max(60, active.layout.width + dx), height: Math.max(36, active.layout.height + dy) } };
    } else if (active.type === "resize-text") {
      previewTexts.value = { ...previewTexts.value, [active.id]: { ...active.text, width: Math.max(40, active.text.width + dx), height: Math.max(24, active.text.height + dy) } };
    }
  }

  async function pointerUp(event: PointerEvent) {
    const point = clientPoint(event);
    app.markCanvasActivity(point);
    release(event);
    if (connect.value?.pressed) {
      if (connect.value.moved && (portSnap.value || relationSnap.value)) await finishConnect(point, event.shiftKey);
      else connect.value = { ...connect.value, pressed: false };
      return;
    }
    const active = drag.value;
    drag.value = null;
    if (!active || active.type === "pan") return;
    if (active.type === "draw-shape") {
      app.mode = "select";
      const draggedWidth = Math.abs(active.end.x - active.start.x);
      const draggedHeight = Math.abs(active.end.y - active.start.y);
      const width = draggedWidth > 8 ? Math.max(40, draggedWidth) : 220;
      const height = draggedHeight > 8 ? Math.max(24, draggedHeight) : 120;
      const x = draggedWidth > 8 ? Math.min(active.start.x, active.end.x) : active.start.x;
      const y = draggedHeight > 8 ? Math.min(active.start.y, active.end.y) : active.start.y;
      await graphStore.mutateGraph("배경 도형 추가", () => api.createText(project.projectId, {
        text: "",
        shape_type: active.shapeType,
        x: snapEnabled.value ? snap(x) : x,
        y: snapEnabled.value ? snap(y) : y,
        width: snapEnabled.value ? Math.max(40, snap(width)) : width,
        height: snapEnabled.value ? Math.max(24, snap(height)) : height,
        background_color: "#f2f4f7",
        border_color: "#98a2b3",
      }));
      return;
    }
    if (active.type === "marquee") {
      const bounds = {
        x: Math.min(active.start.x, active.end.x), y: Math.min(active.start.y, active.end.y),
        width: Math.abs(active.start.x - active.end.x), height: Math.abs(active.start.y - active.end.y),
      };
      if (bounds.width > 4 || bounds.height > 4) {
        const layerHits = graph.value?.layouts.filter((row) => intersects(bounds, row)).map((row) => ({ kind: "layer" as const, id: row.layer_id })) ?? [];
        const textHits = graph.value?.text_boxes.filter((row) => intersects(bounds, row)).map((row) => ({ kind: "text" as const, id: row.id })) ?? [];
        const hits = [...layerHits, ...textHits];
        app.selection = active.additive
          ? [...app.selection, ...hits.filter((hit) => !app.selection.some((row) => row.kind === hit.kind && row.id === hit.id))]
          : hits;
      }
      return;
    }
    if (active.type === "move") {
      const layouts = Object.values(previewLayouts.value).map((row) => ({
        layer_id: row.layer_id,
        x: snapEnabled.value ? snap(row.x) : row.x,
        y: snapEnabled.value ? snap(row.y) : row.y,
      }));
      const text_boxes = Object.values(previewTexts.value).map((row) => ({
        id: row.id,
        x: snapEnabled.value ? snap(row.x) : row.x,
        y: snapEnabled.value ? snap(row.y) : row.y,
      }));
      previewLayouts.value = Object.fromEntries(Object.values(previewLayouts.value).map((row) => [row.layer_id, {
        ...row, x: snapEnabled.value ? snap(row.x) : row.x, y: snapEnabled.value ? snap(row.y) : row.y,
      }]));
      previewTexts.value = Object.fromEntries(Object.values(previewTexts.value).map((row) => [row.id, {
        ...row, x: snapEnabled.value ? snap(row.x) : row.x, y: snapEnabled.value ? snap(row.y) : row.y,
      }]));
      try {
        if (layouts.length || text_boxes.length) await graphStore.mutateGraph("선택 항목 이동", () => api.batchGraph(project.projectId, { layouts, text_boxes }));
      } finally {
        previewLayouts.value = {};
        previewTexts.value = {};
      }
    } else if (active.type === "resize-layer" && previewLayouts.value[active.id]) {
      const ghost = previewLayouts.value[active.id];
      const width = Math.max(60, snapEnabled.value ? snap(ghost.width) : ghost.width);
      const height = Math.max(36, snapEnabled.value ? snap(ghost.height) : ghost.height);
      previewLayouts.value = { ...previewLayouts.value, [active.id]: { ...ghost, width, height } };
      try {
        await graphStore.mutateGraph("Layer 크기 저장", () => api.batchGraph(project.projectId, { layouts: [{ layer_id: active.id, width, height }] }));
      } finally { previewLayouts.value = {} }
    } else if (active.type === "resize-text" && previewTexts.value[active.id]) {
      const ghost = previewTexts.value[active.id];
      const width = Math.max(40, snapEnabled.value ? snap(ghost.width) : ghost.width);
      const height = Math.max(24, snapEnabled.value ? snap(ghost.height) : ghost.height);
      previewTexts.value = { ...previewTexts.value, [active.id]: { ...ghost, width, height } };
      try {
        await graphStore.mutateGraph("텍스트 크기 저장", () => api.updateText(project.projectId, active.id, { width, height }));
      } finally { previewTexts.value = {} }
    } else if (active.type === "drag-waypoint" && previewWaypoints.value[active.id]) {
      const waypoints = previewWaypoints.value[active.id];
      try {
        await graphStore.mutateGraph("Waypoint 저장", () => api.updateRelation(project.projectId, active.id, { waypoints }));
      } finally { previewWaypoints.value = {} }
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

  async function startConnect(event: PointerEvent, layerId: string, port: PortName) {
    event.preventDefault();
    event.stopPropagation();
    app.markCanvasActivity(clientPoint(event));
    if (!project.canEdit) { app.mode = "select"; return }
    const layout = layouts.value.get(layerId);
    if (!layout) return;
    if (connect.value) {
      const source = connect.value;
      if (source.layerId !== layerId) {
        connect.value = null;
        portSnap.value = null;
        relationSnap.value = null;
        app.mode = "select";
        await graphStore.createRelationExpanded({
          parent_layer_id: source.layerId, child_layer_id: layerId, source_port: source.port, target_port: port,
          waypoints: layerConnectionWaypoints(source.layerId, source.port, layerId, port, event.shiftKey),
          relation_style_id: reference.selectedRelationStyleId || null,
        });
      } else {
        connect.value = { ...source, port, start: portHandlePoint(layout, port), pressed: false, moved: false };
      }
      return;
    }
    connect.value = {
      layerId, port, start: portHandlePoint(layout, port), pointerId: event.pointerId,
      originClient: { x: event.clientX, y: event.clientY }, pressed: true, moved: false,
    };
    pointer.value = clientPoint(event);
    app.select({ kind: "layer", id: layerId });
    app.mode = "connect";
    capture(event);
  }

  async function finishConnect(_point: Point, orthogonal = false) {
    const source = connect.value;
    const targetPort = portSnap.value;
    const target = relationSnap.value;
    connect.value = null;
    portSnap.value = null;
    relationSnap.value = null;
    app.mode = "select";
    if (source && targetPort) {
      await graphStore.createRelationExpanded({
        parent_layer_id: source.layerId, child_layer_id: targetPort.layerId,
        source_port: source.port, target_port: targetPort.port,
        waypoints: layerConnectionWaypoints(source.layerId, source.port, targetPort.layerId, targetPort.port, orthogonal),
        relation_style_id: reference.selectedRelationStyleId || null,
      });
    } else if (source && target && raw.value) {
      const targetLayerId = relationTargetLayerId(raw.value, target.relationId);
      if (!targetLayerId) { app.status = "관계선의 Target Layer를 찾을 수 없습니다."; return }
      const route = attachmentRoute(source.layerId, source.port, target);
      if (!route) { app.status = "관계선 접속 경로를 계산할 수 없습니다."; return }
      await graphStore.createRelationExpanded({
        parent_layer_id: source.layerId, child_layer_id: targetLayerId, source_port: source.port,
        target_port: route.targetPort, attached_relation_id: target.relationId,
        waypoints: route.waypoints, relation_style_id: reference.selectedRelationStyleId || null,
      });
    }
  }
  async function relationPointerDown(event: PointerEvent, relation: Relation) {
    event.preventDefault();
    event.stopPropagation();
    app.markCanvasActivity(clientPoint(event));
    const source = connect.value;
    if (!source) {
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      app.select({ kind: "relation", id: relation.id }, additive);
      return;
    }
    connect.value = null;
    portSnap.value = null;
    relationSnap.value = null;
    app.mode = "select";
    if (source.layerId === relation.parent_layer_id || source.layerId === relation.child_layer_id) return;
    if (!raw.value) return;
    const targetLayerId = relationTargetLayerId(raw.value, relation.id);
    if (!targetLayerId) { app.status = "관계선의 Target Layer를 찾을 수 없습니다."; return }
    const targetPath = relationGeometry(relations.value.get(relation.id) ?? relation, layouts.value, relations.value);
    const insertion = closestPointOnPath(clientPoint(event), targetPath);
    if (!insertion) { app.status = "관계선 접속 위치를 찾을 수 없습니다."; return }
    const target = { relationId: relation.id, ...insertion };
    const route = attachmentRoute(source.layerId, source.port, target);
    if (!route) { app.status = "관계선 접속 경로를 계산할 수 없습니다."; return }
    await graphStore.createRelationExpanded({
      parent_layer_id: source.layerId,
      child_layer_id: targetLayerId,
      source_port: source.port,
      target_port: route.targetPort,
      attached_relation_id: relation.id,
      waypoints: route.waypoints,
      relation_style_id: reference.selectedRelationStyleId || null,
    });
  }
  function layerLabel(layer: { name: string; step: string | null }) {
    return app.labelField === "step" ? layer.step?.trim() || layer.name : layer.name;
  }
  function relationAppearance(relation: Relation) {
    return relationStroke(relation.relation_style_id ? relationStyles.value.get(relation.relation_style_id) : undefined, relation.relation_type, relation.same_group);
  }
  function editableWaypoints(relation: Relation) {
    return relationBendWaypoints(relation, previewWaypoints.value[relation.id] ?? relation.waypoints ?? []);
  }
  async function addWaypoint(event: MouseEvent, relation: Relation) {
    event.stopPropagation();
    if (!project.canEdit) return;
    app.markCanvasActivity(clientPoint(event as unknown as PointerEvent));
    const path = relationGeometry(relations.value.get(relation.id) ?? relation, layouts.value, relations.value);
    const insertion = closestPointOnPath(clientPoint(event as unknown as PointerEvent), path);
    if (!insertion) return;
    const point = snapEnabled.value
      ? { x: snap(insertion.point.x), y: snap(insertion.point.y) }
      : insertion.point;
    const waypoints = [...(relation.waypoints ?? [])];
    if (relation.attached_relation_id && !waypoints.length) waypoints.push(path.at(-1)!);
    waypoints.splice(insertion.segmentIndex, 0, point);
    app.select({ kind: "relation", id: relation.id });
    await graphStore.mutateGraph("Waypoint 추가", () => api.updateRelation(project.projectId, relation.id, { waypoints }));
  }
  function waypointDown(event: PointerEvent, relation: Relation, index: number) {
    event.stopPropagation();
    if (!project.canEdit) return;
    app.markCanvasActivity(clientPoint(event));
    drag.value = { type: "drag-waypoint", id: relation.id, index };
    app.select({ kind: "relation", id: relation.id });
    capture(event);
  }
  async function deleteWaypoint(event: MouseEvent, relation: Relation, index: number) {
    event.preventDefault();
    event.stopPropagation();
    if (!project.canEdit) return;
    await graphStore.mutateGraph("Waypoint 삭제", () => api.updateRelation(project.projectId, relation.id, {
      waypoints: (relation.waypoints ?? []).filter((_point, pointIndex) => pointIndex !== index),
    }));
  }
  function focusSearch() {
    const layer = graph.value?.layers.find((row) => layerMatchesQuery(row, app.labelField, query.value));
    const layout = layer ? layouts.value.get(layer.id) : null;
    if (!layer || !layout) return;
    viewBox.value = { x: layout.x - 320, y: layout.y - 220, width: 800, height: 500 };
    app.select({ kind: "layer", id: layer.id });
  }
  async function editLayer(id: string) {
    if (!project.canEdit) return;
    const layer = raw.value?.layers.find((row) => row.id === id);
    if (!layer) return;
    const field = app.labelField;
    const value = prompt(field === "step" ? "Step" : "Layer 이름", field === "step" ? layer.step ?? "" : layer.name);
    if (value == null || (field === "name" && !value.trim())) return;
    await graphStore.mutateGraph("Layer 인라인 저장", () => api.updateLayer(project.projectId, id, field === "step" ? { step: value.trim() || null } : { name: value.trim() }));
  }
  async function editTextBox(id: string) {
    if (!project.canEdit) return;
    const text = raw.value?.text_boxes.find((row) => row.id === id && (row.shape_type ?? "text") === "text");
    if (!text) return;
    const value = prompt("Text", text.text);
    if (value == null || value === text.text) return;
    await graphStore.mutateGraph("Text 인라인 저장", () => api.updateText(project.projectId, id, { text: value }));
  }
  function fit() { viewBox.value = { x: 0, y: 0, width: 1600, height: 1000 } }
  function zoom(factor: number) {
    const center = { x: viewBox.value.x + viewBox.value.width / 2, y: viewBox.value.y + viewBox.value.height / 2 };
    const width = Math.max(280, Math.min(5000, viewBox.value.width * factor));
    const height = width * 0.625;
    viewBox.value = { x: center.x - width / 2, y: center.y - height / 2, width, height };
  }

  return {
    app, graphStore, project, svg, viewBox, snapEnabled, query, pointer, drag, marquee, previewLayouts, previewTexts,
    previewWaypoints, connect, portSnap, relationSnap, relationPaths, graph, raw, layouts, styles, relationStyles, selectedLayers,
    decorativeShapes, annotationTexts, shapePreview,
    selectedRelation, selectedTexts, ports, viewBoxString, portPoint, portHandlePoint, layerLabel, nodePointerDown, textPointerDown, canvasDown,
    pointerMove, pointerUp, wheel, startConnect, relationPointerDown, relationAppearance,
    editableWaypoints, addWaypoint, waypointDown, deleteWaypoint, focusSearch, editLayer, editTextBox, fit, zoom,
  };
}
