import type { Layout, Point, PortName, Relation, RelationStyle } from "../types";

export interface Aabb { x: number; y: number; width: number; height: number }

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

export function relationStroke(style?: RelationStyle) {
  const pattern = style?.line_pattern ?? "solid";
  return {
    stroke: style?.stroke_color ?? "#475467",
    strokeWidth: style?.stroke_width ?? 2,
    strokeDasharray: pattern === "dashed" ? "10 7" : pattern === "dotted" ? "2 6" : pattern === "reference" ? "12 6 2 6" : undefined,
    markerEnd: style?.marker_type === "none" ? undefined : "url(#arrow)",
  };
}

export function snap(value: number, gridSize = 20): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

export function intersects(a: Aabb, b: Aabb): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
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
