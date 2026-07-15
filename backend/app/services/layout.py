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
            if not relation.same_group:
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

    # Group alignment for same_group relations
    same_group_relations = [r for r in relations if r.same_group]
    if same_group_relations:
        adj = defaultdict(list)
        for r in same_group_relations:
            if r.parent_layer_id in indegree and r.child_layer_id in indegree:
                adj[r.parent_layer_id].append(r.child_layer_id)
                adj[r.child_layer_id].append(r.parent_layer_id)
        
        visited = set()
        for node in list(adj.keys()):
            if node not in visited:
                comp = []
                q = deque([node])
                visited.add(node)
                while q:
                    curr = q.popleft()
                    comp.append(curr)
                    for nbr in adj[curr]:
                        if nbr not in visited:
                            visited.add(nbr)
                            q.append(nbr)
                
                # Assign the max rank of the group to all group members
                max_rank = max((ranks.get(lid, 0) for lid in comp), default=0)
                for lid in comp:
                    ranks[lid] = max_rank

    by_rank: dict[int, list[uuid.UUID]] = defaultdict(list)
    for layer_id, rank in ranks.items():
        by_rank[rank].append(layer_id)

    layouts = {
        layout.layer_id: layout
        for layout in db.query(models.GraphLayout).filter(models.GraphLayout.project_id == project_id).all()
    }
    for rank, ranked_ids in by_rank.items():
        # Map layers in the same rank to their group component to place them at the same position
        adj_in_rank = defaultdict(list)
        for r in same_group_relations:
            if r.parent_layer_id in ranked_ids and r.child_layer_id in ranked_ids:
                adj_in_rank[r.parent_layer_id].append(r.child_layer_id)
                adj_in_rank[r.child_layer_id].append(r.parent_layer_id)
        
        rank_visited = set()
        rank_groups = []
        for lid in ranked_ids:
            if lid not in rank_visited:
                comp = []
                q = deque([lid])
                rank_visited.add(lid)
                while q:
                    curr = q.popleft()
                    comp.append(curr)
                    for nbr in adj_in_rank[curr]:
                        if nbr not in rank_visited:
                            rank_visited.add(nbr)
                            q.append(nbr)
                rank_groups.append(comp)

        for group_index, comp in enumerate(rank_groups):
            for lid in comp:
                layout = layouts.get(lid)
                if layout is None:
                    layout = models.GraphLayout(project_id=project_id, layer_id=lid)
                    db.add(layout)
                layout.x = 120 + rank * 260
                layout.y = 100 + group_index * 160
                layout.width = layout.width or 180
                layout.height = layout.height or 72
