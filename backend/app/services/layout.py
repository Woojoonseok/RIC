from __future__ import annotations

import uuid
from collections import defaultdict, deque

from sqlalchemy.orm import Session

from .. import models


def apply_auto_layout(db: Session, project_id: uuid.UUID) -> None:
    layers = db.query(models.Layer).filter(models.Layer.project_id == project_id).order_by(models.Layer.created_at).all()
    relations = db.query(models.LayerRelation).filter(models.LayerRelation.project_id == project_id).all()
    layer_ids = [layer.id for layer in layers]
    indegree = {layer_id: 0 for layer_id in layer_ids}
    graph: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)

    for relation in relations:
        if relation.parent_layer_id in indegree and relation.child_layer_id in indegree:
            graph[relation.parent_layer_id].append(relation.child_layer_id)
            indegree[relation.child_layer_id] += 1

    queue = deque(layer_id for layer_id in layer_ids if indegree[layer_id] == 0)
    ranks: dict[uuid.UUID, int] = {layer_id: 0 for layer_id in queue}
    while queue:
        layer_id = queue.popleft()
        for child_id in graph[layer_id]:
            ranks[child_id] = max(ranks.get(child_id, 0), ranks[layer_id] + 1)
            indegree[child_id] -= 1
            if indegree[child_id] == 0:
                queue.append(child_id)

    for layer_id in layer_ids:
        ranks.setdefault(layer_id, 0)

    by_rank: dict[int, list[uuid.UUID]] = defaultdict(list)
    for layer_id, rank in ranks.items():
        by_rank[rank].append(layer_id)

    layouts = {
        layout.layer_id: layout
        for layout in db.query(models.GraphLayout).filter(models.GraphLayout.project_id == project_id).all()
    }
    for rank, ranked_ids in by_rank.items():
        for index, layer_id in enumerate(ranked_ids):
            layout = layouts.get(layer_id)
            if layout is None:
                layout = models.GraphLayout(project_id=project_id, layer_id=layer_id)
                db.add(layout)
            layout.x = 120 + rank * 280
            layout.y = 100 + index * 140
            layout.width = layout.width or 180
            layout.height = layout.height or 72
