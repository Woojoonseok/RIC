from __future__ import annotations

import uuid
from collections import defaultdict, deque

from sqlalchemy.orm import Session

from .. import models, schemas


def validate_project_graph(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID | None = None,
) -> schemas.ValidationReport:
    """Validate one Align Tree without observing sibling-tree rows.

    The optional id exists only for v1 bundle compatibility; new API routes
    always pass an explicit tree id.
    """
    if align_tree_id is None:
        tree = (
            db.query(models.AlignTree)
            .filter(
                models.AlignTree.project_id == project_id,
                models.AlignTree.deleted_at.is_(None),
            )
            .order_by(models.AlignTree.is_default.desc(), models.AlignTree.created_at, models.AlignTree.id)
            .first()
        )
        if tree is None:
            return schemas.ValidationReport(ok=True, issues=[])
        align_tree_id = tree.id
    else:
        tree = db.get(models.AlignTree, align_tree_id)
        if tree is None or tree.project_id != project_id or tree.deleted_at is not None:
            return schemas.ValidationReport(
                ok=False,
                issues=[schemas.ValidationIssue(
                    code="align_tree_missing",
                    severity="error",
                    message="Align Tree does not belong to the project.",
                )],
            )

    layers = db.query(models.Layer).filter(
        models.Layer.project_id == project_id,
        models.Layer.align_tree_id == align_tree_id,
    ).all()
    relations = db.query(models.LayerRelation).filter(
        models.LayerRelation.project_id == project_id,
        models.LayerRelation.align_tree_id == align_tree_id,
    ).all()
    layer_ids = {layer.id for layer in layers}
    issues: list[schemas.ValidationIssue] = []

    seen_names: set[str] = set()
    for layer in layers:
        normalized = layer.name.strip().lower()
        if not normalized:
            issues.append(schemas.ValidationIssue(
                code="layer_name_empty", severity="error", message="Layer name is required.", layer_id=layer.id
            ))
        if normalized in seen_names:
            issues.append(schemas.ValidationIssue(
                code="layer_name_duplicate",
                severity="error",
                message=f"Layer name '{layer.name}' is duplicated.",
                layer_id=layer.id,
            ))
        seen_names.add(normalized)

    group_by_layer: dict[uuid.UUID, str] = {}
    relation_ids = {relation.id for relation in relations}
    for relation in relations:
        if relation.same_group and relation.parent_layer_id and relation.child_layer_id:
            group_by_layer[relation.parent_layer_id] = relation.same_group
            group_by_layer[relation.child_layer_id] = relation.same_group

    graph: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    indegree: dict[uuid.UUID, int] = {layer_id: 0 for layer_id in layer_ids}
    connected: set[uuid.UUID] = set()

    for relation in relations:
        parent_id = relation.parent_layer_id
        child_id = relation.child_layer_id
        parent_is_spare = relation.parent_endpoint_type == "spare"
        child_is_spare = relation.child_endpoint_type == "spare"
        if not parent_is_spare and (parent_id is None or parent_id not in layer_ids):
            issues.append(schemas.ValidationIssue(
                code="relation_parent_missing",
                severity="error",
                message="Relation references a missing parent layer.",
                relation_id=relation.id,
            ))
        attached_target_is_valid = relation.attached_relation_id in relation_ids if relation.attached_relation_id else False
        if not child_is_spare and (
            (child_id is None and not attached_target_is_valid)
            or (child_id is not None and child_id not in layer_ids)
        ):
            issues.append(schemas.ValidationIssue(
                code="relation_child_missing",
                severity="error",
                message="Relation references a missing child layer.",
                relation_id=relation.id,
            ))
        if not parent_is_spare and not child_is_spare and parent_id is not None and parent_id == child_id:
            issues.append(schemas.ValidationIssue(
                code="relation_self_loop",
                severity="error",
                message="A layer cannot connect to itself.",
                relation_id=relation.id,
                layer_id=parent_id,
            ))

        if not parent_is_spare and not child_is_spare and parent_id in layer_ids and child_id in layer_ids:
            connected.update((parent_id, child_id))
            if relation.same_group:
                continue
            if parent_id in group_by_layer and child_id in group_by_layer:
                issues.append(schemas.ValidationIssue(
                    code="relation_group_to_group",
                    severity="error",
                    message="A relation between two group boxes is not allowed.",
                    relation_id=relation.id,
                ))
            graph[parent_id].append(child_id)
            indegree[child_id] += 1

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
        issues.append(schemas.ValidationIssue(
            code="relation_cycle", severity="error", message="Layer relations contain a cycle."
        ))

    for layer in layers:
        if len(layers) > 1 and layer.id not in connected:
            issues.append(schemas.ValidationIssue(
                code="layer_isolated",
                severity="warning",
                message=f"Layer '{layer.name}' has no relation.",
                layer_id=layer.id,
            ))

    return schemas.ValidationReport(
        ok=all(issue.severity != "error" for issue in issues),
        issues=issues,
    )
