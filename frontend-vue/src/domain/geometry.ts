import type { Layout, Point, PortName, Relation } from "../types";

export function portPoint(layout: Layout, port: PortName): Point {
  if (port === "top") return { x: layout.x + layout.width / 2, y: layout.y };
  if (port === "right") return { x: layout.x + layout.width, y: layout.y + layout.height / 2 };
  if (port === "bottom") return { x: layout.x + layout.width / 2, y: layout.y + layout.height };
  return { x: layout.x, y: layout.y + layout.height / 2 };
}

export function closestPointOnSegment(point: Point, start: Point, end: Point): Point & { t: number; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const projected = lengthSquared ? ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared : 0.5;
  const t = Math.max(0.05, Math.min(0.95, projected));
  const x = start.x + dx * t;
  const y = start.y + dy * t;
  return { x, y, t, distance: Math.hypot(point.x - x, point.y - y) };
}

export function relationPoints(
  relation: Relation,
  layouts: Map<string, Layout>,
  relations: Map<string, Relation>,
  visiting = new Set<string>(),
): Point[] {
  if (visiting.has(relation.id) || !relation.parent_layer_id) return [];
  const sourceLayout = layouts.get(relation.parent_layer_id);
  if (!sourceLayout) return [];
  const nextVisiting = new Set(visiting).add(relation.id);
  const points: Point[] = [portPoint(sourceLayout, relation.source_port), ...(relation.waypoints ?? [])];
  if (relation.attached_relation_id) {
    const targetRelation = relations.get(relation.attached_relation_id);
    const targetPath = targetRelation ? relationPoints(targetRelation, layouts, relations, nextVisiting) : [];
    const probe = points.at(-1)!;
    let closest: Point & { distance: number } | null = null;
    for (let index = 0; index < targetPath.length - 1; index += 1) {
      const candidate = closestPointOnSegment(probe, targetPath[index], targetPath[index + 1]);
      if (!closest || candidate.distance < closest.distance) closest = candidate;
    }
    if (closest) points.push({ x: closest.x, y: closest.y });
  } else if (relation.child_layer_id) {
    const targetLayout = layouts.get(relation.child_layer_id);
    if (targetLayout) points.push(portPoint(targetLayout, relation.target_port));
  }
  return points;
}

export function findRelationSnap(point: Point, paths: Array<{ relationId: string; points: Point[] }>, threshold = 24) {
  let best: { relationId: string; point: Point; distance: number } | null = null;
  for (const path of paths) {
    for (let index = 0; index < path.points.length - 1; index += 1) {
      const candidate = closestPointOnSegment(point, path.points[index], path.points[index + 1]);
      if (candidate.distance <= threshold && (!best || candidate.distance < best.distance)) {
        best = { relationId: path.relationId, point: { x: candidate.x, y: candidate.y }, distance: candidate.distance };
      }
    }
  }
  return best;
}

export function snap(value: number, gridSize = 20) { return Math.round(value / gridSize) * gridSize }
