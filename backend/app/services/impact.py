from __future__ import annotations

import uuid
from collections import defaultdict, deque

from sqlalchemy.orm import Session

from .. import models, schemas


def _reachable(start: uuid.UUID, graph: dict[uuid.UUID, set[uuid.UUID]]) -> set[uuid.UUID]:
    visited: set[uuid.UUID] = set()
    queue = deque(graph.get(start, set()))
    while queue:
        layer_id = queue.popleft()
        if layer_id in visited or layer_id == start:
            continue
        visited.add(layer_id)
        queue.extend(graph.get(layer_id, set()) - visited)
    return visited


def _relation_label(relation: models.LayerRelation, layer_names: dict[uuid.UUID, str]) -> str:
    parent = "SPARE" if relation.parent_endpoint_type == "spare" else layer_names.get(relation.parent_layer_id)
    child = "SPARE" if relation.child_endpoint_type == "spare" else layer_names.get(relation.child_layer_id)
    if child is None and relation.attached_relation_id is not None:
        child = f"Relation {str(relation.attached_relation_id)[:8]}"
    return f"{parent or '미지정'} → {child or '미지정'}"


def _exports(relation: models.LayerRelation) -> bool:
    if relation.same_group:
        return False
    parent_valid = relation.parent_endpoint_type == "spare" or relation.parent_layer_id is not None
    child_valid = relation.child_endpoint_type == "spare" or relation.child_layer_id is not None
    return parent_valid and child_valid


def _dependency_graphs(
    relations: list[models.LayerRelation],
) -> tuple[dict[uuid.UUID, set[uuid.UUID]], dict[uuid.UUID, set[uuid.UUID]]]:
    forward: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    reverse: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for relation in relations:
        if relation.same_group or relation.parent_layer_id is None or relation.child_layer_id is None:
            continue
        forward[relation.parent_layer_id].add(relation.child_layer_id)
        reverse[relation.child_layer_id].add(relation.parent_layer_id)
    return forward, reverse


def _attached_relations(
    relations: list[models.LayerRelation],
    affected_ids: set[uuid.UUID],
) -> list[models.LayerRelation]:
    attachment_ids: set[uuid.UUID] = set()
    changed = True
    while changed:
        changed = False
        for relation in relations:
            if relation.id in affected_ids or relation.attached_relation_id not in affected_ids:
                continue
            affected_ids.add(relation.id)
            attachment_ids.add(relation.id)
            changed = True
    return [relation for relation in relations if relation.id in attachment_ids]


def _relation_target_layer(
    relation: models.LayerRelation,
    relation_by_id: dict[uuid.UUID, models.LayerRelation],
    visited: set[uuid.UUID] | None = None,
) -> uuid.UUID | None:
    if relation.child_layer_id is not None:
        return relation.child_layer_id
    if relation.attached_relation_id is None:
        return None
    seen = visited or set()
    if relation.id in seen:
        return None
    target = relation_by_id.get(relation.attached_relation_id)
    return _relation_target_layer(target, relation_by_id, seen | {relation.id}) if target else None


def build_layer_impact(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    layer: models.Layer,
) -> schemas.LayerImpactReport:
    layers = (
        db.query(models.Layer)
        .filter(models.Layer.project_id == project_id, models.Layer.align_tree_id == align_tree_id)
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
    layer_by_id = {row.id: row for row in layers}
    layer_names = {row.id: row.name for row in layers}
    forward, reverse = _dependency_graphs(relations)

    direct = [
        relation for relation in relations
        if relation.parent_layer_id == layer.id or relation.child_layer_id == layer.id
    ]
    affected_ids = {relation.id for relation in direct}
    attachments = _attached_relations(relations, affected_ids)
    affected = direct + attachments

    enabled_rules = (
        db.query(models.ValidationRule)
        .filter(models.ValidationRule.project_id == project_id, models.ValidationRule.enabled.is_(True))
        .order_by(models.ValidationRule.sort_order, models.ValidationRule.created_at)
        .all()
    )
    rules = [
        rule for rule in enabled_rules
        if rule.target_type == "layer" or (affected and rule.target_type == "relation")
    ]
    tree = db.get(models.AlignTree, align_tree_id)
    table_cells = tree.final_table_cells if tree is not None else {}
    deleted_relation_keys = {str(item.id) for item in direct}
    saved_table_value_count = sum(
        1
        for relation_id, values in table_cells.items()
        for key, value in values.items()
        if value and (relation_id in deleted_relation_keys or key == str(layer.id))
    )
    if tree is not None:
        saved_table_value_count += int(bool(tree.layer_process_names.get(str(layer.id))))
        saved_table_value_count += int(bool(tree.layer_gds_names.get(str(layer.id))))

    def node(layer_id: uuid.UUID) -> schemas.LayerImpactNode:
        row = layer_by_id[layer_id]
        return schemas.LayerImpactNode(id=row.id, name=row.name, step=row.step)

    def relation_summary(row: models.LayerRelation, deleted: bool) -> schemas.LayerImpactRelation:
        return schemas.LayerImpactRelation(
            id=row.id,
            label=_relation_label(row, layer_names),
            relation_type=row.relation_type,
            attached_relation_id=row.attached_relation_id,
            will_be_deleted=deleted,
        )

    upstream = sorted(_reachable(layer.id, reverse), key=lambda item: (layer_names.get(item, ""), str(item)))
    downstream = sorted(_reachable(layer.id, forward), key=lambda item: (layer_names.get(item, ""), str(item)))
    return schemas.LayerImpactReport(
        layer=node(layer.id),
        upstream_layers=[node(item) for item in upstream],
        downstream_layers=[node(item) for item in downstream],
        direct_relations=[relation_summary(row, True) for row in direct],
        attachment_relations=[relation_summary(row, False) for row in attachments],
        validation_rules=[
            schemas.LayerImpactRule(
                id=rule.id,
                name=rule.name,
                target_type=rule.target_type,
                severity=rule.severity,
                rule_type=rule.rule_type,
                field_name=rule.field_name,
            )
            for rule in rules
        ],
        overlay_key_count=sum(1 for relation in affected if not relation.same_group),
        export_row_count=sum(1 for relation in affected if _exports(relation)),
        saved_table_value_count=saved_table_value_count,
    )


def build_relation_impact(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    relation: models.LayerRelation,
) -> schemas.RelationImpactReport:
    layers = (
        db.query(models.Layer)
        .filter(models.Layer.project_id == project_id, models.Layer.align_tree_id == align_tree_id)
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
    layer_by_id = {row.id: row for row in layers}
    layer_names = {row.id: row.name for row in layers}
    relation_by_id = {row.id: row for row in relations}
    forward, reverse = _dependency_graphs(relations)
    affected_ids = {relation.id}
    attachments = _attached_relations(relations, affected_ids)
    affected = [relation, *attachments]

    parent_id = relation.parent_layer_id
    child_id = _relation_target_layer(relation, relation_by_id)
    upstream_ids = ({parent_id} | _reachable(parent_id, reverse)) if parent_id else set()
    downstream_ids = ({child_id} | _reachable(child_id, forward)) if child_id else set()
    rules = (
        db.query(models.ValidationRule)
        .filter(
            models.ValidationRule.project_id == project_id,
            models.ValidationRule.enabled.is_(True),
            models.ValidationRule.target_type == "relation",
        )
        .order_by(models.ValidationRule.sort_order, models.ValidationRule.created_at)
        .all()
    )
    tree = db.get(models.AlignTree, align_tree_id)
    relation_cells = tree.final_table_cells.get(str(relation.id), {}) if tree is not None else {}

    def node(layer_id: uuid.UUID) -> schemas.LayerImpactNode:
        row = layer_by_id[layer_id]
        return schemas.LayerImpactNode(id=row.id, name=row.name, step=row.step)

    def relation_summary(row: models.LayerRelation, deleted: bool) -> schemas.LayerImpactRelation:
        return schemas.LayerImpactRelation(
            id=row.id,
            label=_relation_label(row, layer_names),
            relation_type=row.relation_type,
            attached_relation_id=row.attached_relation_id,
            will_be_deleted=deleted,
        )

    return schemas.RelationImpactReport(
        relation=relation_summary(relation, True),
        upstream_layers=[node(item) for item in sorted(upstream_ids, key=lambda item: (layer_names.get(item, ""), str(item)))],
        downstream_layers=[node(item) for item in sorted(downstream_ids, key=lambda item: (layer_names.get(item, ""), str(item)))],
        direct_relations=[relation_summary(relation, True)],
        attachment_relations=[relation_summary(row, False) for row in attachments],
        validation_rules=[
            schemas.LayerImpactRule(
                id=rule.id,
                name=rule.name,
                target_type="relation",
                severity=rule.severity,
                rule_type=rule.rule_type,
                field_name=rule.field_name,
            )
            for rule in rules
        ],
        overlay_key_count=sum(1 for row in affected if not row.same_group),
        export_row_count=sum(1 for row in affected if _exports(row)),
        saved_table_value_count=sum(1 for value in relation_cells.values() if value),
    )
