from __future__ import annotations

import uuid
from collections import defaultdict, deque

from sqlalchemy.orm import Session

from .. import models, schemas


def validate_project_graph(db: Session, project_id: uuid.UUID) -> schemas.ValidationReport:
    layers = db.query(models.Layer).filter(models.Layer.project_id == project_id).all()
    relations = db.query(models.LayerRelation).filter(models.LayerRelation.project_id == project_id).all()
    layer_ids = {layer.id for layer in layers}
    issues: list[schemas.ValidationIssue] = []

    seen_names: set[str] = set()
    for layer in layers:
        normalized = layer.name.strip().lower()
        if not normalized:
            issues.append(
                schemas.ValidationIssue(
                    code="layer_name_empty",
                    severity="error",
                    message="Layer name is required.",
                    layer_id=layer.id,
                )
            )
        if normalized in seen_names:
            issues.append(
                schemas.ValidationIssue(
                    code="layer_name_duplicate",
                    severity="error",
                    message=f"Layer name '{layer.name}' is duplicated.",
                    layer_id=layer.id,
                )
            )
        seen_names.add(normalized)

    relation_keys: set[tuple[uuid.UUID, uuid.UUID]] = set()
    graph: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    indegree: dict[uuid.UUID, int] = {layer_id: 0 for layer_id in layer_ids}

    for relation in relations:
        if relation.parent_layer_id not in layer_ids:
            issues.append(
                schemas.ValidationIssue(
                    code="relation_parent_missing",
                    severity="error",
                    message="Relation references a missing parent layer.",
                    relation_id=relation.id,
                )
            )
        if relation.child_layer_id not in layer_ids:
            issues.append(
                schemas.ValidationIssue(
                    code="relation_child_missing",
                    severity="error",
                    message="Relation references a missing child layer.",
                    relation_id=relation.id,
                )
            )
        if relation.parent_layer_id == relation.child_layer_id:
            issues.append(
                schemas.ValidationIssue(
                    code="relation_self_loop",
                    severity="error",
                    message="A layer cannot connect to itself.",
                    relation_id=relation.id,
                    layer_id=relation.parent_layer_id,
                )
            )

        key = (relation.parent_layer_id, relation.child_layer_id)
        if key in relation_keys:
            issues.append(
                schemas.ValidationIssue(
                    code="relation_duplicate",
                    severity="error",
                    message="Duplicate layer relation.",
                    relation_id=relation.id,
                )
            )
        relation_keys.add(key)

        if relation.parent_layer_id in layer_ids and relation.child_layer_id in layer_ids:
            graph[relation.parent_layer_id].append(relation.child_layer_id)
            indegree[relation.child_layer_id] += 1

    visited_count = 0
    queue = deque(layer_id for layer_id, count in indegree.items() if count == 0)
    while queue:
        layer_id = queue.popleft()
        visited_count += 1
        for child_id in graph[layer_id]:
            indegree[child_id] -= 1
            if indegree[child_id] == 0:
                queue.append(child_id)

    if layer_ids and visited_count != len(layer_ids):
        issues.append(
            schemas.ValidationIssue(
                code="relation_cycle",
                severity="error",
                message="Layer relations contain a cycle.",
            )
        )

    connected = {relation.parent_layer_id for relation in relations} | {relation.child_layer_id for relation in relations}
    for layer in layers:
        if len(layers) > 1 and layer.id not in connected:
            issues.append(
                schemas.ValidationIssue(
                    code="layer_isolated",
                    severity="warning",
                    message=f"Layer '{layer.name}' has no relation.",
                    layer_id=layer.id,
                )
            )

    return schemas.ValidationReport(
        ok=all(issue.severity != "error" for issue in issues),
        issues=issues,
    )
