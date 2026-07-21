from __future__ import annotations

import uuid
from collections import defaultdict, deque

from sqlalchemy.orm import Session

from .. import models


def apply_auto_layout(db: Session, project_id: uuid.UUID, align_tree_id: uuid.UUID) -> None:
    layers = (
        db.query(models.Layer)
        .filter(models.Layer.project_id == project_id, models.Layer.align_tree_id == align_tree_id)
        .order_by(models.Layer.created_at)
        .all()
    )
    relations = (
        db.query(models.LayerRelation)
        .filter(
            models.LayerRelation.project_id == project_id,
            models.LayerRelation.align_tree_id == align_tree_id,
        )
        .all()
    )

    layer_ids = [layer.id for layer in layers]

    indegree = {layer_id: 0 for layer_id in layer_ids}
    graph: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)

    # same_group이 아닌 관계만 실제 위->아래 방향 관계로 사용
    for relation in relations:
        if (
            relation.parent_layer_id in indegree
            and relation.child_layer_id in indegree
            and not relation.same_group
        ):
            graph[relation.parent_layer_id].append(relation.child_layer_id)
            indegree[relation.child_layer_id] += 1

    # Topological rank 계산
    queue = deque(layer_id for layer_id in layer_ids if indegree[layer_id] == 0)
    ranks: dict[uuid.UUID, int] = {layer_id: 0 for layer_id in queue}

    while queue:
        layer_id = queue.popleft()

        for child_id in graph[layer_id]:
            ranks[child_id] = max(
                ranks.get(child_id, 0),
                ranks[layer_id] + 1,
            )
            indegree[child_id] -= 1

            if indegree[child_id] == 0:
                queue.append(child_id)

    # 순환 등으로 rank가 안 잡힌 layer는 최상단에 배치
    for layer_id in layer_ids:
        ranks.setdefault(layer_id, 0)

    # same_group 관계는 같은 rank로 맞춤
    same_group_relations = [r for r in relations if r.same_group]

    if same_group_relations:
        same_group_adj: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)

        valid_layer_ids = set(layer_ids)

        for relation in same_group_relations:
            if (
                relation.parent_layer_id in valid_layer_ids
                and relation.child_layer_id in valid_layer_ids
            ):
                same_group_adj[relation.parent_layer_id].append(relation.child_layer_id)
                same_group_adj[relation.child_layer_id].append(relation.parent_layer_id)

        visited: set[uuid.UUID] = set()

        for node in list(same_group_adj.keys()):
            if node in visited:
                continue

            component: list[uuid.UUID] = []
            q = deque([node])
            visited.add(node)

            while q:
                current = q.popleft()
                component.append(current)

                for neighbor in same_group_adj[current]:
                    if neighbor not in visited:
                        visited.add(neighbor)
                        q.append(neighbor)

            # 같은 그룹은 가장 깊은 rank로 통일
            max_rank = max((ranks.get(layer_id, 0) for layer_id in component), default=0)

            for layer_id in component:
                ranks[layer_id] = max_rank

    # rank별 그룹핑
    by_rank: dict[int, list[uuid.UUID]] = defaultdict(list)

    for layer_id in layer_ids:
        by_rank[ranks[layer_id]].append(layer_id)

    layouts = {
        layout.layer_id: layout
        for layout in (
            db.query(models.GraphLayout)
            .filter(
                models.GraphLayout.project_id == project_id,
                models.GraphLayout.align_tree_id == align_tree_id,
            )
            .all()
        )
    }

    # 배치 파라미터
    start_x = 120
    start_y = 100
    node_width = 180
    node_height = 72
    horizontal_gap = 260
    vertical_gap = 160

    for rank in sorted(by_rank.keys()):
        ranked_ids = by_rank[rank]

        # 같은 rank 안에서 same_group끼리는 같은 위치에 겹쳐 배치
        same_group_adj_in_rank: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
        ranked_id_set = set(ranked_ids)

        for relation in same_group_relations:
            if (
                relation.parent_layer_id in ranked_id_set
                and relation.child_layer_id in ranked_id_set
            ):
                same_group_adj_in_rank[relation.parent_layer_id].append(
                    relation.child_layer_id
                )
                same_group_adj_in_rank[relation.child_layer_id].append(
                    relation.parent_layer_id
                )

        rank_visited: set[uuid.UUID] = set()
        rank_groups: list[list[uuid.UUID]] = []

        for layer_id in ranked_ids:
            if layer_id in rank_visited:
                continue

            component: list[uuid.UUID] = []
            q = deque([layer_id])
            rank_visited.add(layer_id)

            while q:
                current = q.popleft()
                component.append(current)

                for neighbor in same_group_adj_in_rank[current]:
                    if neighbor not in rank_visited:
                        rank_visited.add(neighbor)
                        q.append(neighbor)

            rank_groups.append(component)

        # 핵심 변경:
        # rank는 y축, 같은 rank 내 group_index는 x축
        for group_index, component in enumerate(rank_groups):
            x = start_x + group_index * horizontal_gap
            y = start_y + rank * vertical_gap

            for layer_id in component:
                layout = layouts.get(layer_id)

                if layout is None:
                    layout = models.GraphLayout(
                        project_id=project_id,
                        align_tree_id=align_tree_id,
                        layer_id=layer_id,
                    )
                    db.add(layout)

                layout.x = x
                layout.y = y
                layout.width = layout.width or node_width
                layout.height = layout.height or node_height

                import sys
                print(f"[LAYOUT] layer_id={layer_id}, rank={rank}, group_index={group_index}, x={x}, y={y}", file=sys.stderr)
