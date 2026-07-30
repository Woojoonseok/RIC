import type { Layout, Point, PortName, Relation, RelationStyle } from "../types";

export interface Aabb { x: number; y: number; width: number; height: number }

export function facingPorts(source: Aabb, target: Aabb): { source: PortName; target: PortName } {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2);
  const dy = target.y + target.height / 2 - (source.y + source.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
  return dy >= 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
}

export function portPoint(layout: Layout, port: PortName): Point {
  if (port === "top") return { x: layout.x + layout.width / 2, y: layout.y };
  if (port === "right") return { x: layout.x + layout.width, y: layout.y + layout.height / 2 };
  if (port === "bottom") return { x: layout.x + layout.width / 2, y: layout.y + layout.height };
  return { x: layout.x, y: layout.y + layout.height / 2 };
}

export function portHandlePoint(layout: Layout, port: PortName, distance = 18): Point {
  const point = portPoint(layout, port);
  if (port === "top") return { x: point.x, y: point.y - distance };
  if (port === "right") return { x: point.x + distance, y: point.y };
  if (port === "bottom") return { x: point.x, y: point.y + distance };
  return { x: point.x - distance, y: point.y };
}

export function relationStroke(style?: RelationStyle, type = "", sameGroup?: string | null) {
  if (sameGroup) return { stroke: "#16a34a", strokeWidth: 3, strokeDasharray: "4 4", markerEnd: undefined };
  if (style) {
    const pattern = style.line_pattern;
    return {
      stroke: style.stroke_color,
      strokeWidth: style.stroke_width,
      strokeDasharray: pattern === "dashed" ? "8 6" : pattern === "dotted" ? "2 6" : pattern === "reference" ? "10 4 2 4" : undefined,
      markerEnd: style.marker_type === "none" ? undefined : "url(#arrow)",
    };
  }
  const normalized = type.toLowerCase();
  if (normalized === "reference") return { stroke: "#7c3aed", strokeWidth: 2, strokeDasharray: "10 4 2 4", markerEnd: "url(#arrow)" };
  if (normalized === "optional" || normalized === "warning") return { stroke: "#0891b2", strokeWidth: 2, strokeDasharray: "2 5", markerEnd: "url(#arrow)" };
  if (normalized === "overlay") return { stroke: "#f97316", strokeWidth: 2, strokeDasharray: undefined, markerEnd: "url(#arrow)" };
  return { stroke: "#334155", strokeWidth: 2, strokeDasharray: undefined, markerEnd: "url(#arrow)" };
}

export function snap(value: number, gridSize = 20): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

function horizontalPort(port: PortName): boolean {
  return port === "left" || port === "right";
}

function compactOrthogonalPoints(start: Point, candidates: Point[], end: Point): Point[] {
  const points = [start, ...candidates, end].filter((point, index, rows) => (
    index === 0 || point.x !== rows[index - 1].x || point.y !== rows[index - 1].y
  ));
  for (let index = points.length - 2; index > 0; index -= 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if ((previous.x === current.x && current.x === next.x) || (previous.y === current.y && current.y === next.y)) {
      points.splice(index, 1);
    }
  }
  return points.slice(1, -1);
}

export function orthogonalWaypoints(start: Point, sourcePort: PortName, end: Point, targetPort: PortName): Point[] {
  const sourceHorizontal = horizontalPort(sourcePort);
  const targetHorizontal = horizontalPort(targetPort);
  if (sourceHorizontal !== targetHorizontal) {
    const corner = sourceHorizontal ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
    return compactOrthogonalPoints(start, [corner], end);
  }
  if (sourceHorizontal) {
    const bendX = sourcePort === targetPort
      ? (sourcePort === "right" ? Math.max(start.x, end.x) + 40 : Math.min(start.x, end.x) - 40)
      : (start.x + end.x) / 2;
    return compactOrthogonalPoints(start, [{ x: bendX, y: start.y }, { x: bendX, y: end.y }], end);
  }
  const bendY = sourcePort === targetPort
    ? (sourcePort === "bottom" ? Math.max(start.y, end.y) + 40 : Math.min(start.y, end.y) - 40)
    : (start.y + end.y) / 2;
  return compactOrthogonalPoints(start, [{ x: start.x, y: bendY }, { x: end.x, y: bendY }], end);
}

export function intersects(a: Aabb, b: Aabb): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function getClosestPointOnSegment(point: Point, start: Point, end: Point): Point & { t: number; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const projected = lengthSquared ? ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared : 0.5;
  const t = Math.max(0.05, Math.min(0.95, projected));
  const x = start.x + dx * t;
  const y = start.y + dy * t;
  return { x, y, t, distance: Math.hypot(point.x - x, point.y - y) };
}

export const closestPointOnSegment = getClosestPointOnSegment;

export function closestPointOnPath(point: Point, path: Point[]) {
  let best: { point: Point; segmentIndex: number; distance: number } | null = null;
  for (let index = 0; index < path.length - 1; index += 1) {
    const candidate = getClosestPointOnSegment(point, path[index], path[index + 1]);
    if (!best || candidate.distance < best.distance) {
      best = {
        point: { x: candidate.x, y: candidate.y },
        segmentIndex: index,
        distance: candidate.distance,
      };
    }
  }
  return best;
}

export function relationGeometry(
  relation: Relation,
  layouts: Map<string, Layout>,
  relations: Map<string, Relation>,
  visited = new Set<string>(),
): Point[] {
  if (visited.has(relation.id) || !relation.parent_layer_id) return [];
  const sourceLayout = layouts.get(relation.parent_layer_id);
  if (!sourceLayout) return [];

  const nextVisited = new Set(visited).add(relation.id);
  const points: Point[] = [portPoint(sourceLayout, relation.source_port), ...(relation.waypoints ?? [])];
  if (relation.attached_relation_id) {
    const targetRelation = relations.get(relation.attached_relation_id);
    const targetPath = targetRelation ? relationGeometry(targetRelation, layouts, relations, nextVisited) : [];
    if (targetPath.length < 2) return [];
    const probe = points.at(-1)!;
    let closest: ReturnType<typeof getClosestPointOnSegment> | null = null;
    for (let index = 0; index < targetPath.length - 1; index += 1) {
      const candidate = getClosestPointOnSegment(probe, targetPath[index], targetPath[index + 1]);
      if (!closest || candidate.distance < closest.distance) closest = candidate;
    }
    if (!closest) return [];
    return [...points, { x: closest.x, y: closest.y }];
  }

  if (!relation.child_layer_id) return [];
  const targetLayout = layouts.get(relation.child_layer_id);
  return targetLayout ? [...points, portPoint(targetLayout, relation.target_port)] : [];
}

export const relationPoints = relationGeometry;

export function findRelationSnap(point: Point, paths: Array<{ relationId: string; points: Point[] }>, threshold = 24) {
  let best: { relationId: string; point: Point; distance: number } | null = null;
  for (const path of paths) {
    for (let index = 0; index < path.points.length - 1; index += 1) {
      const candidate = getClosestPointOnSegment(point, path.points[index], path.points[index + 1]);
      if (candidate.distance <= threshold && (!best || candidate.distance < best.distance)) {
        best = { relationId: path.relationId, point: { x: candidate.x, y: candidate.y }, distance: candidate.distance };
      }
    }
  }
  return best;
}
