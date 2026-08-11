from __future__ import annotations

import uuid
from collections import defaultdict, deque
from dataclasses import dataclass

from sqlalchemy.orm import Session

from .. import models


@dataclass(frozen=True)
class LayoutPreset:
    direction: str
    rank_gap: float
    cross_gap: float


PRESETS = {
    "top_down": LayoutPreset("vertical", 180, 280),
    "left_right": LayoutPreset("horizontal", 300, 150),
    "compact": LayoutPreset("vertical", 135, 225),
    "spacious": LayoutPreset("vertical", 230, 350),
}


def _components(
    layer_ids: list[uuid.UUID], relations: list[models.LayerRelation]
) -> tuple[list[list[uuid.UUID]], dict[uuid.UUID, int]]:
    parent = {layer_id: layer_id for layer_id in layer_ids}

    def find(layer_id: uuid.UUID) -> uuid.UUID:
        while parent[layer_id] != layer_id:
            parent[layer_id] = parent[parent[layer_id]]
            layer_id = parent[layer_id]
        return layer_id

    def union(left: uuid.UUID, right: uuid.UUID) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    valid = set(layer_ids)
    for relation in relations:
        if relation.same_group and relation.parent_layer_id in valid and relation.child_layer_id in valid:
            union(relation.parent_layer_id, relation.child_layer_id)

    grouped: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for layer_id in layer_ids:
        grouped[find(layer_id)].append(layer_id)
    components = list(grouped.values())
    component_by_layer = {
        layer_id: index for index, component in enumerate(components) for layer_id in component
    }
    return components, component_by_layer


def _component_ranks(
    components: list[list[uuid.UUID]],
    component_by_layer: dict[uuid.UUID, int],
    relations: list[models.LayerRelation],
) -> dict[int, int]:
    graph: dict[int, set[int]] = defaultdict(set)
    indegree = {index: 0 for index in range(len(components))}
    for relation in relations:
        if relation.same_group or not relation.parent_layer_id or not relation.child_layer_id:
            continue
        source = component_by_layer.get(relation.parent_layer_id)
        target = component_by_layer.get(relation.child_layer_id)
        if source is None or target is None or source == target or target in graph[source]:
            continue
        graph[source].add(target)
        indegree[target] += 1

    queue = deque(index for index, degree in indegree.items() if degree == 0)
    ranks = {index: 0 for index in queue}
    while queue:
        index = queue.popleft()
        for target in graph[index]:
            ranks[target] = max(ranks.get(target, 0), ranks[index] + 1)
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    for index in range(len(components)):
        ranks.setdefault(index, 0)
    return ranks


def _overlaps(
    candidate: tuple[float, float, float, float],
    occupied: list[tuple[float, float, float, float]],
    margin: float = 32,
) -> bool:
    x, y, width, height = candidate
    return any(
        x < other_x + other_width + margin
        and x + width + margin > other_x
        and y < other_y + other_height + margin
        and y + height + margin > other_y
        for other_x, other_y, other_width, other_height in occupied
    )


def _port_point(layout: models.GraphLayout, port: str) -> tuple[float, float]:
    if port == "top":
        return layout.x + layout.width / 2, layout.y
    if port == "right":
        return layout.x + layout.width, layout.y + layout.height / 2
    if port == "bottom":
        return layout.x + layout.width / 2, layout.y + layout.height
    return layout.x, layout.y + layout.height / 2


def _segment_hits_rectangles(
    start: tuple[float, float],
    end: tuple[float, float],
    rectangles: list[tuple[float, float, float, float]],
    margin: float = 12,
) -> bool:
    x1, y1 = start
    x2, y2 = end
    for x, y, width, height in rectangles:
        left, right = x - margin, x + width + margin
        top, bottom = y - margin, y + height + margin
        if x1 == x2 and left < x1 < right and max(y1, y2) > top and min(y1, y2) < bottom:
            return True
        if y1 == y2 and top < y1 < bottom and max(x1, x2) > left and min(x1, x2) < right:
            return True
    return False


def _clear_path(
    points: list[tuple[float, float]], rectangles: list[tuple[float, float, float, float]]
) -> bool:
    return all(
        not _segment_hits_rectangles(points[index], points[index + 1], rectangles)
        for index in range(len(points) - 1)
    )


def _compact_waypoints(points: list[tuple[float, float]]) -> list[dict[str, float]]:
    compact = [points[0]]
    for point in points[1:]:
        if point != compact[-1]:
            compact.append(point)
    index = len(compact) - 2
    while index > 0:
        previous, current, following = compact[index - 1 : index + 2]
        if (previous[0] == current[0] == following[0]) or (previous[1] == current[1] == following[1]):
            compact.pop(index)
        index -= 1
    return [{"x": point[0], "y": point[1]} for point in compact[1:-1]]


def _route_relations(
    relations: list[models.LayerRelation],
    layouts: dict[uuid.UUID, models.GraphLayout],
    moved_layer_ids: set[uuid.UUID],
    direction: str,
) -> None:
    all_rectangles = {
        layer_id: (layout.x, layout.y, layout.width, layout.height)
        for layer_id, layout in layouts.items()
    }
    routed = [
        relation
        for relation in relations
        if not relation.same_group
        and not relation.attached_relation_id
        and relation.parent_layer_id in layouts
        and relation.child_layer_id in layouts
        and ({relation.parent_layer_id, relation.child_layer_id} & moved_layer_ids)
    ]
    for index, relation in enumerate(routed):
        source = layouts[relation.parent_layer_id]
        target = layouts[relation.child_layer_id]
        lane = ((index % 7) - 3) * 14
        if direction == "horizontal":
            forward = target.x + target.width / 2 >= source.x + source.width / 2
            relation.source_port = "right" if forward else "left"
            relation.target_port = "left" if forward else "right"
        else:
            forward = target.y + target.height / 2 >= source.y + source.height / 2
            relation.source_port = "bottom" if forward else "top"
            relation.target_port = "top" if forward else "bottom"

        start = _port_point(source, relation.source_port)
        end = _port_point(target, relation.target_port)
        obstacles = [
            rectangle
            for layer_id, rectangle in all_rectangles.items()
            if layer_id not in {relation.parent_layer_id, relation.child_layer_id}
        ]
        if direction == "horizontal":
            middle = (start[0] + end[0]) / 2 + lane
            points = [start, (middle, start[1]), (middle, end[1]), end]
            if not _clear_path(points, obstacles):
                corridor = max(y + height for _, y, _, height in obstacles) + 55 + abs(lane)
                source_stub = start[0] + (36 if relation.source_port == "right" else -36)
                target_stub = end[0] + (-36 if relation.target_port == "left" else 36)
                points = [start, (source_stub, start[1]), (source_stub, corridor), (target_stub, corridor), (target_stub, end[1]), end]
        else:
            middle = (start[1] + end[1]) / 2 + lane
            points = [start, (start[0], middle), (end[0], middle), end]
            if not _clear_path(points, obstacles):
                corridor = max(x + width for x, _, width, _ in obstacles) + 55 + abs(lane)
                source_stub = start[1] + (36 if relation.source_port == "bottom" else -36)
                target_stub = end[1] + (-36 if relation.target_port == "top" else 36)
                points = [start, (start[0], source_stub), (corridor, source_stub), (corridor, target_stub), (end[0], target_stub), end]
        relation.waypoints = _compact_waypoints(points)


def apply_auto_layout(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    *,
    scope: str = "all",
    selected_layer_ids: set[uuid.UUID] | None = None,
    preset: str = "top_down",
    route_relations: bool = True,
) -> set[uuid.UUID]:
    layers = (
        db.query(models.Layer)
        .filter(models.Layer.project_id == project_id, models.Layer.align_tree_id == align_tree_id)
        .order_by(models.Layer.created_at, models.Layer.id)
        .all()
    )
    relations = (
        db.query(models.LayerRelation)
        .filter(
            models.LayerRelation.project_id == project_id,
            models.LayerRelation.align_tree_id == align_tree_id,
        )
        .order_by(models.LayerRelation.created_at, models.LayerRelation.id)
        .all()
    )
    layer_ids = [layer.id for layer in layers]
    layouts = {
        layout.layer_id: layout
        for layout in db.query(models.GraphLayout).filter(
            models.GraphLayout.project_id == project_id,
            models.GraphLayout.align_tree_id == align_tree_id,
        ).all()
    }
    for layer_id in layer_ids:
        if layer_id not in layouts:
            layouts[layer_id] = models.GraphLayout(
                project_id=project_id, align_tree_id=align_tree_id, layer_id=layer_id
            )
            db.add(layouts[layer_id])

    components, component_by_layer = _components(layer_ids, relations)
    ranks = _component_ranks(components, component_by_layer, relations)
    requested = set(selected_layer_ids or ())
    movable_components = {
        index
        for index, component in enumerate(components)
        if not any(layouts[layer_id].pinned for layer_id in component)
        and (scope == "all" or bool(requested.intersection(component)))
    }
    moved_layer_ids = {
        layer_id for index in movable_components for layer_id in components[index]
    }
    if not moved_layer_ids:
        return set()

    selected_layouts = [layouts[layer_id] for layer_id in moved_layer_ids]
    anchor_x = 120 if scope == "all" else min(layout.x for layout in selected_layouts)
    anchor_y = 100 if scope == "all" else min(layout.y for layout in selected_layouts)
    layout_preset = PRESETS.get(preset, PRESETS["top_down"])
    min_rank = min(ranks[index] for index in movable_components)
    occupied = [
        (layout.x, layout.y, layout.width, layout.height)
        for layer_id, layout in layouts.items()
        if layer_id not in moved_layer_ids
    ]
    by_rank: dict[int, list[int]] = defaultdict(list)
    for index in sorted(movable_components):
        by_rank[ranks[index]].append(index)

    for rank in sorted(by_rank):
        for cross_index, component_index in enumerate(by_rank[rank]):
            component = components[component_index]
            width = max(layouts[layer_id].width for layer_id in component)
            height = max(layouts[layer_id].height for layer_id in component)
            if layout_preset.direction == "horizontal":
                x = anchor_x + (rank - min_rank) * layout_preset.rank_gap
                y = anchor_y + cross_index * layout_preset.cross_gap
                while _overlaps((x, y, width, height), occupied):
                    y += layout_preset.cross_gap
            else:
                x = anchor_x + cross_index * layout_preset.cross_gap
                y = anchor_y + (rank - min_rank) * layout_preset.rank_gap
                while _overlaps((x, y, width, height), occupied):
                    x += layout_preset.cross_gap
            for layer_id in component:
                layouts[layer_id].x = x
                layouts[layer_id].y = y
            occupied.append((x, y, width, height))

    if route_relations:
        _route_relations(relations, layouts, moved_layer_ids, layout_preset.direction)
    return moved_layer_ids
