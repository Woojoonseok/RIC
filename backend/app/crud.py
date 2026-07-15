from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from . import models, schemas
from .services.box_presets import ensure_default_box_presets
from .services.relation_styles import ensure_default_relation_styles
from .services.validation import validate_project_graph


def get_project_or_404(db: Session, project_id: uuid.UUID) -> models.Project:
    project = db.get(models.Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def create_project(db: Session, payload: schemas.ProjectCreate) -> models.Project:
    project = models.Project(name=payload.name, description=payload.description)
    db.add(project)
    db.flush()
    ensure_default_relation_styles(db)
    ensure_default_box_presets(db)
    db.commit()
    db.refresh(project)
    return project


def create_layer(db: Session, project_id: uuid.UUID, payload: schemas.LayerCreate) -> models.Layer:
    get_project_or_404(db, project_id)
    preset = get_box_preset_or_404(db, project_id, payload.box_preset_id) if payload.box_preset_id else None
    layer = models.Layer(
        project_id=project_id,
        name=payload.name,
        step=payload.step,
        layer_property=payload.layer_property,
        align=payload.align,
        align_side=payload.align_side,
        description=payload.description,
        metadata_json=payload.metadata_json,
        box_preset_id=preset.id if preset else None,
        pending_group=payload.pending_group,
    )
    db.add(layer)
    db.flush()
    db.add(
        models.GraphLayout(
            project_id=project_id,
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
            layer_id=layer.id,
            fill_color=preset.fill_color if preset else "#ffffff",
            stroke_color=preset.stroke_color if preset else "#2563eb",
            text_color=preset.text_color if preset else "#111827",
            font_size=preset.font_size if preset else 14,
            stroke_width=preset.stroke_width if preset else 2,
        )
    )
    db.commit()
    db.refresh(layer)
    return layer


def get_layer_or_404(db: Session, project_id: uuid.UUID, layer_id: uuid.UUID) -> models.Layer:
    layer = db.get(models.Layer, layer_id)
    if layer is None or layer.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer not found")
    return layer


def get_relation_or_404(db: Session, project_id: uuid.UUID, relation_id: uuid.UUID) -> models.LayerRelation:
    relation = db.get(models.LayerRelation, relation_id)
    if relation is None or relation.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relation not found")
    return relation


def get_relation_style_or_404(db: Session, project_id: uuid.UUID, style_id: uuid.UUID) -> models.RelationStyle:
    relation_style = db.get(models.RelationStyle, style_id)
    if relation_style is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relation style not found")
    return relation_style


def get_box_preset_or_404(db: Session, project_id: uuid.UUID, preset_id: uuid.UUID) -> models.BoxPreset:
    preset = db.get(models.BoxPreset, preset_id)
    if preset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Box preset not found")
    return preset


def get_text_box_or_404(db: Session, project_id: uuid.UUID, text_box_id: uuid.UUID) -> models.TextBox:
    text_box = db.get(models.TextBox, text_box_id)
    if text_box is None or text_box.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Text box not found")
    return text_box


def read_graph(db: Session, project_id: uuid.UUID) -> schemas.GraphRead:
    project = get_project_or_404(db, project_id)
    relation_styles = (
        db.query(models.RelationStyle)
        .order_by(models.RelationStyle.sort_order, models.RelationStyle.name)
        .all()
    )
    layers = db.query(models.Layer).filter(models.Layer.project_id == project_id).order_by(models.Layer.created_at).all()
    layouts = db.query(models.GraphLayout).filter(models.GraphLayout.project_id == project_id).all()
    styles = db.query(models.ShapeStyle).filter(models.ShapeStyle.project_id == project_id).all()
    box_presets = (
        db.query(models.BoxPreset)
        .order_by(models.BoxPreset.sort_order, models.BoxPreset.name)
        .all()
    )
    relations = db.query(models.LayerRelation).filter(models.LayerRelation.project_id == project_id).all()
    text_boxes = db.query(models.TextBox).filter(models.TextBox.project_id == project_id).order_by(models.TextBox.id).all()
    return schemas.GraphRead(
        project=project,
        layers=layers,
        layouts=layouts,
        styles=styles,
        box_presets=box_presets,
        relation_styles=relation_styles,
        relations=relations,
        text_boxes=text_boxes,
        validation=validate_project_graph(db, project_id),
    )


def delete_layer_with_relations(db: Session, project_id: uuid.UUID, layer_id: uuid.UUID) -> dict[str, list[models.LayerRelation]]:
    get_layer_or_404(db, project_id, layer_id)
    incoming = (
        db.query(models.LayerRelation)
        .filter(models.LayerRelation.project_id == project_id, models.LayerRelation.child_layer_id == layer_id)
        .all()
    )
    outgoing = (
        db.query(models.LayerRelation)
        .filter(models.LayerRelation.project_id == project_id, models.LayerRelation.parent_layer_id == layer_id)
        .all()
    )
    for relation in incoming + outgoing:
        db.delete(relation)
    layer = get_layer_or_404(db, project_id, layer_id)
    db.delete(layer)
    db.commit()
    return {"incoming": incoming, "outgoing": outgoing}
