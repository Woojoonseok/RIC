from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from . import models, schemas
from .services.validation import validate_project_graph


def get_project_or_404(db: Session, project_id: uuid.UUID) -> models.Project:
    project = db.get(models.Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def get_align_tree_or_404(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID | None = None,
) -> models.AlignTree:
    """Return a tree only when it belongs to the project in the URL.

    ``align_tree_id=None`` is retained for the temporary v1 bundle/route
    compatibility layer and resolves to the active default tree. New callers
    must pass the tree id explicitly.
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
    else:
        tree = db.get(models.AlignTree, align_tree_id)
    if tree is None or tree.project_id != project_id or tree.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Align Tree not found")
    return tree


def create_project(
    db: Session,
    payload: schemas.ProjectCreate,
    owner_actor_id: uuid.UUID | None = None,
) -> models.Project:
    project = models.Project(name=payload.name, description=payload.description, owner_actor_id=owner_actor_id)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def create_layer(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.LayerCreate,
) -> models.Layer:
    get_project_or_404(db, project_id)
    get_align_tree_or_404(db, project_id, align_tree_id)
    preset = get_box_preset_or_404(db, project_id, payload.box_preset_id) if payload.box_preset_id else None
    layer = models.Layer(
        project_id=project_id,
        align_tree_id=align_tree_id,
        name=payload.name,
        color=payload.color,
        step=payload.step,
        layer_property=payload.layer_property,
        align=payload.align,
        align_side=payload.align_side,
        description=payload.description,
        metadata_json=payload.metadata_json,
        box_preset_id=preset.id if preset else None,
    )
    db.add(layer)
    db.flush()
    db.add(
        models.GraphLayout(
            project_id=project_id,
            align_tree_id=align_tree_id,
            layer_id=layer.id,
            x=payload.x,
            y=payload.y,
            width=preset.width if preset else payload.width,
            height=preset.height if preset else payload.height,
        )
    )
    db.add(
        models.ShapeStyle(
            project_id=project_id,
            align_tree_id=align_tree_id,
            layer_id=layer.id,
            fill_color=preset.fill_color if preset else "#ffffff",
            stroke_color=preset.stroke_color if preset else "#2563eb",
            text_color=preset.text_color if preset else "#111827",
            font_size=preset.font_size if preset else 14,
            stroke_width=preset.stroke_width if preset else 2,
        )
    )
    # The route owns the transaction so its audit event is committed or
    # rolled back atomically with these rows.
    db.flush()
    return layer


def get_layer_or_404(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    layer_id: uuid.UUID,
) -> models.Layer:
    layer = db.get(models.Layer, layer_id)
    if layer is None or layer.project_id != project_id or layer.align_tree_id != align_tree_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")
    return layer


def get_relation_or_404(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    relation_id: uuid.UUID,
) -> models.LayerRelation:
    relation = db.get(models.LayerRelation, relation_id)
    if relation is None or relation.project_id != project_id or relation.align_tree_id != align_tree_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relation not found")
    return relation


def get_relation_style_or_404(
    db: Session,
    project_id: uuid.UUID,
    style_id: uuid.UUID,
) -> models.RelationStyle:
    relation_style = db.get(models.RelationStyle, style_id)
    if relation_style is None or relation_style.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relation style not found")
    return relation_style


def get_box_preset_or_404(
    db: Session,
    project_id: uuid.UUID,
    preset_id: uuid.UUID,
) -> models.BoxPreset:
    preset = db.get(models.BoxPreset, preset_id)
    if preset is None or preset.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Box preset not found")
    return preset


def get_text_box_or_404(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    text_box_id: uuid.UUID,
) -> models.TextBox:
    text_box = db.get(models.TextBox, text_box_id)
    if text_box is None or text_box.project_id != project_id or text_box.align_tree_id != align_tree_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Text box not found")
    return text_box


def read_graph(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID | None = None,
) -> schemas.GraphRead:
    project = get_project_or_404(db, project_id)
    align_tree = get_align_tree_or_404(db, project_id, align_tree_id)
    project_payload: models.Project | schemas.ProjectRead = project
    actor_id = db.info.get("current_actor_id")
    if actor_id is not None:
        actor = db.get(models.Actor, actor_id)
        if actor is not None:
            # Local import avoids a module cycle: project_access also uses the
            # core model/schema modules.
            from .services.project_access import project_to_read

            project_payload = project_to_read(db, project, actor)
    relation_styles = (
        db.query(models.RelationStyle)
        .filter(models.RelationStyle.project_id == project_id)
        .order_by(models.RelationStyle.sort_order, models.RelationStyle.created_at)
        .all()
    )
    layers = (
        db.query(models.Layer)
        .filter(models.Layer.project_id == project_id, models.Layer.align_tree_id == align_tree.id)
        .order_by(models.Layer.created_at)
        .all()
    )
    layouts = db.query(models.GraphLayout).filter(
        models.GraphLayout.project_id == project_id,
        models.GraphLayout.align_tree_id == align_tree.id,
    ).all()
    styles = db.query(models.ShapeStyle).filter(
        models.ShapeStyle.project_id == project_id,
        models.ShapeStyle.align_tree_id == align_tree.id,
    ).all()
    box_presets = (
        db.query(models.BoxPreset)
        .filter(models.BoxPreset.project_id == project_id)
        .order_by(models.BoxPreset.sort_order, models.BoxPreset.created_at)
        .all()
    )
    relations = db.query(models.LayerRelation).filter(
        models.LayerRelation.project_id == project_id,
        models.LayerRelation.align_tree_id == align_tree.id,
    ).all()
    text_boxes = (
        db.query(models.TextBox)
        .filter(models.TextBox.project_id == project_id, models.TextBox.align_tree_id == align_tree.id)
        .order_by(models.TextBox.created_at)
        .all()
    )
    return schemas.GraphRead(
        project=project_payload,
        align_tree=align_tree,
        layers=layers,
        layouts=layouts,
        styles=styles,
        box_presets=box_presets,
        relation_styles=relation_styles,
        relations=relations,
        text_boxes=text_boxes,
        validation=validate_project_graph(db, project_id, align_tree.id),
    )


def delete_layer_with_relations(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    layer_id: uuid.UUID,
) -> dict[str, list[models.LayerRelation]]:
    get_layer_or_404(db, project_id, align_tree_id, layer_id)
    incoming = (
        db.query(models.LayerRelation)
        .filter(
            models.LayerRelation.project_id == project_id,
            models.LayerRelation.align_tree_id == align_tree_id,
            models.LayerRelation.child_layer_id == layer_id,
        )
        .all()
    )
    outgoing = (
        db.query(models.LayerRelation)
        .filter(
            models.LayerRelation.project_id == project_id,
            models.LayerRelation.align_tree_id == align_tree_id,
            models.LayerRelation.parent_layer_id == layer_id,
        )
        .all()
    )
    relation_ids = {str(relation.id) for relation in incoming + outgoing}
    tree = db.get(models.AlignTree, align_tree_id)
    if tree is not None:
        layer_key = str(layer_id)
        tree.layer_process_names = {
            key: value for key, value in tree.layer_process_names.items() if key != layer_key
        }
        tree.layer_gds_names = {
            key: value for key, value in tree.layer_gds_names.items() if key != layer_key
        }
        final_table_cells: dict[str, dict[str, str]] = {}
        for relation_id, values in tree.final_table_cells.items():
            if relation_id in relation_ids:
                continue
            remaining = {key: value for key, value in values.items() if key != layer_key}
            if remaining:
                final_table_cells[relation_id] = remaining
        tree.final_table_cells = final_table_cells
    for relation in incoming + outgoing:
        db.delete(relation)
    layer = get_layer_or_404(db, project_id, align_tree_id, layer_id)
    db.delete(layer)
    db.flush()
    return {"incoming": incoming, "outgoing": outgoing}
