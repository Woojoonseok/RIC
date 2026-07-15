<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../../api/client";
import { findRelationSnap, portPoint, relationPoints, snap } from "../../domain/geometry";
import { useEditorStore } from "../../stores/editor";
import type { Layout, Point, PortName, Relation, TextBox } from "../../types";

const store = useEditorStore();
const svg = ref<SVGSVGElement | null>(null);
const viewBox = ref({ x: 0, y: 0, width: 1600, height: 1000 });
const snapEnabled = ref(true);
const query = ref("");
const pointer = ref<Point>({ x: 0, y: 0 });
const marquee = ref<{ start: Point; end: Point } | null>(null);
const drag = ref<null | { type: "pan" | "layer" | "resize" | "text" | "resize-text" | "waypoint"; id?: string; index?: number; start: Point; origin: Point; layout?: Layout; text?: TextBox }>(null);
const previewLayouts = ref<Record<string, Layout>>({});
const previewTexts = ref<Record<string, TextBox>>({});
const previewWaypoints = ref<Record<string, Point[]>>({});
const connect = ref<null | { layerId: string; port: PortName; start: Point }>(null);
const relationSnap = ref<ReturnType<typeof findRelationSnap>>(null);

const graph = computed(() => store.displayGraph);
const raw = computed(() => store.graph);
const layouts = computed(() => new Map(graph.value?.layouts.map((row) => [row.layer_id, previewLayouts.value[row.layer_id] ?? row]) ?? []));
const styles = computed(() => new Map(graph.value?.styles.map((row) => [row.layer_id, row]) ?? []));
const relationStyles = computed(() => new Map(graph.value?.relation_styles.map((row) => [row.id, row]) ?? []));
const relations = computed(() => new Map(graph.value?.relations.map((row) => [row.id, previewWaypoints.value[row.id] ? { ...row, waypoints: previewWaypoints.value[row.id] } : row]) ?? []));
const relationPaths = computed(() => graph.value?.relations.map((relation) => ({ relationId: relation.id, points: relationPoints(relations.value.get(relation.id)!, layouts.value, relations.value) })) ?? []);
const selectedLayers = computed(() => new Set(store.selection.filter((row) => row.kind === "layer").map((row) => row.id)));
const selectedRelation = computed(() => store.selection.find((row) => row.kind === "relation")?.id ?? null);
const selectedTexts = computed(() => new Set(store.selection.filter((row) => row.kind === "text").map((row) => row.id)));
const ports: PortName[] = ["top", "right", "bottom", "left"];
const viewBoxString = computed(() => `${viewBox.value.x} ${viewBox.value.y} ${viewBox.value.width} ${viewBox.value.height}`);

function clientPoint(event: PointerEvent | WheelEvent): Point {
  if (svg.value) {
    try {
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.value.getScreenCTM()!.inverse());
      return { x: point.x, y: point.y };
    } catch { /* viewBox fallback below */ }
    const rect = svg.value.getBoundingClientRect();
    return { x: viewBox.value.x + (event.clientX - rect.left) / rect.width * viewBox.value.width, y: viewBox.value.y + (event.clientY - rect.top) / rect.height * viewBox.value.height };
  }
  return { x: 0, y: 0 };
}
function nodePointerDown(event: PointerEvent, id: string, resize = false) {
  if (store.mode === "connect") return;
  event.stopPropagation();
  store.select({ kind: "layer", id }, event.ctrlKey || event.metaKey || event.shiftKey);
  const layout = layouts.value.get(id); if (!layout) return;
  drag.value = { type: resize ? "resize" : "layer", id, start: clientPoint(event), origin: { x: layout.x, y: layout.y }, layout: { ...layout } };
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
}
function textPointerDown(event: PointerEvent, row: TextBox, resize = false) {
  if (row.locked) return;
  event.stopPropagation(); store.select({ kind: "text", id: row.id }, event.ctrlKey || event.metaKey);
  drag.value = { type: resize ? "resize-text" : "text", id: row.id, start: clientPoint(event), origin: { x: row.x, y: row.y }, text: { ...row } };
}
function canvasDown(event: PointerEvent) {
  const point = clientPoint(event); pointer.value = point;
  if (event.altKey || event.button === 1) drag.value = { type: "pan", start: { x: event.clientX, y: event.clientY }, origin: { x: viewBox.value.x, y: viewBox.value.y } };
  else if (store.mode === "text") void store.mutateGraph("텍스트 추가", () => api.createText(store.projectId, { text: "Text", x: point.x, y: point.y }));
  else { if (!event.ctrlKey && !event.metaKey) store.selection = []; marquee.value = { start: point, end: point } }
}
function pointerMove(event: PointerEvent) {
  const point = clientPoint(event); pointer.value = point;
  if (connect.value) {
    const candidates = relationPaths.value.filter((path) => path.relationId !== selectedRelation.value);
    relationSnap.value = findRelationSnap(point, candidates, 24 * viewBox.value.width / Math.max(1, svg.value?.clientWidth ?? 1600));
  }
  if (marquee.value) marquee.value.end = point;
  if (!drag.value) return;
  if (drag.value.type === "pan") {
    const scaleX = viewBox.value.width / Math.max(1, svg.value?.clientWidth ?? 1); const scaleY = viewBox.value.height / Math.max(1, svg.value?.clientHeight ?? 1);
    viewBox.value.x = drag.value.origin.x - (event.clientX - drag.value.start.x) * scaleX; viewBox.value.y = drag.value.origin.y - (event.clientY - drag.value.start.y) * scaleY; return;
  }
  const dx = point.x - drag.value.start.x; const dy = point.y - drag.value.start.y;
  if ((drag.value.type === "layer" || drag.value.type === "resize") && drag.value.id && drag.value.layout) {
    const row = { ...drag.value.layout };
    if (drag.value.type === "layer") { row.x = snapEnabled.value ? snap(drag.value.origin.x + dx) : drag.value.origin.x + dx; row.y = snapEnabled.value ? snap(drag.value.origin.y + dy) : drag.value.origin.y + dy }
    else { row.width = Math.max(60, snapEnabled.value ? snap(drag.value.layout.width + dx) : drag.value.layout.width + dx); row.height = Math.max(36, snapEnabled.value ? snap(drag.value.layout.height + dy) : drag.value.layout.height + dy) }
    previewLayouts.value = { ...previewLayouts.value, [drag.value.id]: row };
  } else if ((drag.value.type === "text" || drag.value.type === "resize-text") && drag.value.id && drag.value.text) {
    const next = drag.value.type === "text"
      ? { ...drag.value.text, x: drag.value.origin.x + dx, y: drag.value.origin.y + dy }
      : { ...drag.value.text, width: Math.max(40, drag.value.text.width + dx), height: Math.max(24, drag.value.text.height + dy) };
    previewTexts.value = { ...previewTexts.value, [drag.value.id]: next };
  } else if (drag.value.type === "waypoint" && drag.value.id && drag.value.index !== undefined) {
    const row = relations.value.get(drag.value.id); if (!row) return; const next = [...(row.waypoints ?? [])]; next[drag.value.index] = snapEnabled.value ? { x: snap(point.x), y: snap(point.y) } : point; previewWaypoints.value = { ...previewWaypoints.value, [drag.value.id]: next };
  }
}
async function pointerUp(event: PointerEvent) {
  const point = clientPoint(event);
  if (connect.value) { await finishConnect(point); return }
  if (marquee.value) {
    const { start, end } = marquee.value; const bounds = { x1: Math.min(start.x, end.x), x2: Math.max(start.x, end.x), y1: Math.min(start.y, end.y), y2: Math.max(start.y, end.y) };
    if (Math.abs(start.x - end.x) > 4 || Math.abs(start.y - end.y) > 4) store.selection = graph.value?.layouts.filter((row) => row.x >= bounds.x1 && row.y >= bounds.y1 && row.x + row.width <= bounds.x2 && row.y + row.height <= bounds.y2).map((row) => ({ kind: "layer" as const, id: row.layer_id })) ?? [];
    marquee.value = null;
  }
  const active = drag.value; drag.value = null; if (!active?.id) return;
  const activeId = active.id;
  if ((active.type === "layer" || active.type === "resize") && previewLayouts.value[active.id]) {
    const row = previewLayouts.value[active.id]; previewLayouts.value = {};
    await store.mutateGraph("Layer 배치 저장", () => api.batchGraph(store.projectId, { layouts: [{ layer_id: activeId, x: row.x, y: row.y, width: row.width, height: row.height }] }));
  } else if ((active.type === "text" || active.type === "resize-text") && previewTexts.value[active.id]) {
    const row = previewTexts.value[active.id]; previewTexts.value = {};
    await store.mutateGraph("텍스트 저장", () => api.updateText(store.projectId, active.id!, { x: row.x, y: row.y, width: row.width, height: row.height }));
  } else if (active.type === "waypoint" && previewWaypoints.value[active.id]) {
    const waypoints = previewWaypoints.value[active.id]; previewWaypoints.value = {};
    await store.mutateGraph("Waypoint 저장", () => api.updateRelation(store.projectId, active.id!, { waypoints }));
  }
}
function wheel(event: WheelEvent) {
  event.preventDefault(); const point = clientPoint(event); const factor = event.deltaY > 0 ? 1.12 : 0.88; const width = Math.max(280, Math.min(5000, viewBox.value.width * factor)); const height = width / (viewBox.value.width / viewBox.value.height); const ratioX = (point.x - viewBox.value.x) / viewBox.value.width; const ratioY = (point.y - viewBox.value.y) / viewBox.value.height; viewBox.value = { x: point.x - width * ratioX, y: point.y - height * ratioY, width, height };
}
function startConnect(event: PointerEvent, layerId: string, port: PortName) { event.stopPropagation(); const layout = layouts.value.get(layerId); if (!layout) return; connect.value = { layerId, port, start: portPoint(layout, port) }; pointer.value = clientPoint(event) }
async function finishPort(event: PointerEvent, layerId: string, port: PortName) { event.stopPropagation(); if (!connect.value || connect.value.layerId === layerId) return; const source = connect.value; connect.value = null; relationSnap.value = null; await store.mutateGraph("관계 생성", () => api.createRelation(store.projectId, { parent_layer_id: source.layerId, child_layer_id: layerId, source_port: source.port, target_port: port, relation_style_id: store.selectedRelationStyleId || null })) }
async function finishConnect(_point: Point) { const source = connect.value; const target = relationSnap.value; connect.value = null; relationSnap.value = null; if (source && target) await store.mutateGraph("관계선 연결", () => api.createRelation(store.projectId, { parent_layer_id: source.layerId, child_layer_id: null, source_port: source.port, attached_relation_id: target.relationId, relation_style_id: store.selectedRelationStyleId || null })) }
function relationPolyline(relation: Relation) { return relationPoints(relations.value.get(relation.id)!, layouts.value, relations.value).map((point) => `${point.x},${point.y}`).join(" ") }
function dash(relation: Relation) { const style = relation.relation_style_id ? relationStyles.value.get(relation.relation_style_id) : undefined; return style?.line_pattern === "dashed" ? "10 7" : style?.line_pattern === "dotted" ? "2 6" : style?.line_pattern === "reference" ? "12 6 2 6" : undefined }
async function addWaypoint(event: MouseEvent, relation: Relation) { event.stopPropagation(); const point = clientPoint(event as unknown as PointerEvent); await store.mutateGraph("Waypoint 추가", () => api.updateRelation(store.projectId, relation.id, { waypoints: [...(relation.waypoints ?? []), point] })) }
function waypointDown(event: PointerEvent, relation: Relation, index: number) { event.stopPropagation(); drag.value = { type: "waypoint", id: relation.id, index, start: clientPoint(event), origin: { x: 0, y: 0 } }; store.select({ kind: "relation", id: relation.id }) }
async function deleteWaypoint(event: MouseEvent, relation: Relation, index: number) { event.preventDefault(); event.stopPropagation(); await store.mutateGraph("Waypoint 삭제", () => api.updateRelation(store.projectId, relation.id, { waypoints: relation.waypoints.filter((_point, pointIndex) => pointIndex !== index) })) }
function focusSearch() { const layer = graph.value?.layers.find((row) => row.name.toLowerCase().includes(query.value.toLowerCase())); const layout = layer ? layouts.value.get(layer.id) : null; if (layout) { viewBox.value = { x: layout.x - 320, y: layout.y - 220, width: 800, height: 500 }; store.select({ kind: "layer", id: layer!.id }) } }
async function editLayer(id: string) { const layer = raw.value?.layers.find((row) => row.id === id); if (!layer) return; const name = prompt("Layer 이름", layer.name); if (!name?.trim()) return; const step = prompt("Step", layer.step ?? ""); await store.mutateGraph("Layer 인라인 저장", () => api.updateLayer(store.projectId, id, { name: name.trim(), step: step?.trim() || null })) }
function fit() { viewBox.value = { x: 0, y: 0, width: 1600, height: 1000 } }
</script>

<template>
  <div class="canvas-pane">
    <div class="canvas-float"><input v-model="query" placeholder="Layer 검색" @keydown.enter="focusSearch"><button @click="focusSearch">찾기</button><button @click="fit">전체 보기</button><label><input v-model="snapEnabled" type="checkbox">20px Snap</label></div>
    <svg ref="svg" class="canvas" :class="`${store.mode}-mode`" :viewBox="viewBoxString" @pointerdown="canvasDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @wheel="wheel">
      <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e9edf3" stroke-width="1"/></pattern><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="context-stroke"/></marker></defs>
      <rect :x="viewBox.x" :y="viewBox.y" :width="viewBox.width" :height="viewBox.height" fill="url(#grid)"/>
      <g v-for="relation in graph?.relations" :key="relation.id" class="relation-group" @click.stop="store.select({ kind: 'relation', id: relation.id })" @dblclick="addWaypoint($event, relation)">
        <polyline class="relation-hit" :points="relationPolyline(relation)"/>
        <polyline class="relation-line" :class="{ selected: selectedRelation === relation.id }" :points="relationPolyline(relation)" fill="none" :stroke="relationStyles.get(relation.relation_style_id || '')?.stroke_color || '#475467'" :stroke-width="relationStyles.get(relation.relation_style_id || '')?.stroke_width || 2" :stroke-dasharray="dash(relation)" marker-end="url(#arrow)"/>
        <circle v-for="(point, index) in (previewWaypoints[relation.id] || relation.waypoints)" :key="index" class="waypoint" :cx="point.x" :cy="point.y" r="7" @pointerdown="waypointDown($event, relation, index)" @contextmenu="deleteWaypoint($event, relation, index)"/>
      </g>
      <polyline v-if="connect" class="connect-preview" :points="`${connect.start.x},${connect.start.y} ${relationSnap?.point.x ?? pointer.x},${relationSnap?.point.y ?? pointer.y}`"/>
      <circle v-if="relationSnap" class="snap-dot" :cx="relationSnap.point.x" :cy="relationSnap.point.y" r="9"/>
      <g v-for="layer in graph?.layers" :key="layer.id" class="layer-node" :class="{ selected: selectedLayers.has(layer.id) }" @pointerdown="nodePointerDown($event, layer.id)" @dblclick.stop="editLayer(layer.id)">
        <template v-if="layouts.get(layer.id)"><rect :x="layouts.get(layer.id)!.x" :y="layouts.get(layer.id)!.y" :width="layouts.get(layer.id)!.width" :height="layouts.get(layer.id)!.height" rx="12" :fill="styles.get(layer.id)?.fill_color || '#fff'" :stroke="styles.get(layer.id)?.stroke_color || '#175cd3'" :stroke-width="styles.get(layer.id)?.stroke_width || 2"/><text :x="layouts.get(layer.id)!.x + layouts.get(layer.id)!.width / 2" :y="layouts.get(layer.id)!.y + layouts.get(layer.id)!.height / 2" text-anchor="middle" dominant-baseline="middle" :fill="styles.get(layer.id)?.text_color || '#101828'" :font-size="styles.get(layer.id)?.font_size || 14"><tspan v-for="(line, index) in layer.name.split('\n')" :key="index" :x="layouts.get(layer.id)!.x + layouts.get(layer.id)!.width / 2" :dy="index ? 18 : -(layer.name.split('\n').length - 1) * 9">{{ line }}</tspan></text>
          <template v-if="selectedLayers.has(layer.id) || store.mode === 'connect'"><g v-for="port in ports" :key="port"><circle class="port" :cx="portPoint(layouts.get(layer.id)!, port).x" :cy="portPoint(layouts.get(layer.id)!, port).y" r="8" @pointerdown="startConnect($event, layer.id, port)" @pointerup="finishPort($event, layer.id, port)"/></g></template>
          <rect v-if="selectedLayers.has(layer.id) && store.mode === 'select'" class="resize-handle" :x="layouts.get(layer.id)!.x + layouts.get(layer.id)!.width - 6" :y="layouts.get(layer.id)!.y + layouts.get(layer.id)!.height - 6" width="12" height="12" @pointerdown="nodePointerDown($event, layer.id, true)"/>
        </template>
      </g>
      <g v-for="text in graph?.text_boxes" :key="text.id" class="text-box" :class="{ selected: selectedTexts.has(text.id) }" @pointerdown="textPointerDown($event, previewTexts[text.id] || text)"><rect :x="(previewTexts[text.id] || text).x" :y="(previewTexts[text.id] || text).y" :width="(previewTexts[text.id] || text).width" :height="(previewTexts[text.id] || text).height" :fill="text.background_color" :stroke="text.border_color"/><text :x="(previewTexts[text.id] || text).x + 8" :y="(previewTexts[text.id] || text).y + (previewTexts[text.id] || text).height / 2" dominant-baseline="middle" :fill="text.text_color" :font-size="text.font_size">{{ text.text }}</text><rect v-if="selectedTexts.has(text.id) && !text.locked" class="resize-handle" :x="(previewTexts[text.id] || text).x + (previewTexts[text.id] || text).width - 6" :y="(previewTexts[text.id] || text).y + (previewTexts[text.id] || text).height - 6" width="12" height="12" @pointerdown.stop="textPointerDown($event, previewTexts[text.id] || text, true)"/></g>
      <rect v-if="marquee" class="marquee" :x="Math.min(marquee.start.x, marquee.end.x)" :y="Math.min(marquee.start.y, marquee.end.y)" :width="Math.abs(marquee.end.x - marquee.start.x)" :height="Math.abs(marquee.end.y - marquee.start.y)"/>
    </svg>
    <svg v-if="graph" class="minimap" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#f8fafc"/><rect v-for="layout in graph.layouts" :key="layout.id" :x="layout.x" :y="layout.y" :width="layout.width" :height="layout.height" rx="8" fill="#84adff"/><rect :x="viewBox.x" :y="viewBox.y" :width="viewBox.width" :height="viewBox.height" fill="none" stroke="#175cd3" stroke-width="10"/></svg>
    <div class="canvas-hint">Alt + 드래그 이동 · 휠 확대/축소 · 관계선 더블클릭 waypoint · 우클릭 waypoint 삭제</div>
  </div>
</template>
