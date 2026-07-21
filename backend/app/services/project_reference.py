from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from .. import models
from .box_presets import ensure_default_box_presets
from .relation_styles import ensure_default_relation_styles


def _copy_columns(row: Any, *, exclude: set[str]) -> dict[str, Any]:
    return {
        column.name: getattr(row, column.name)
        for column in row.__table__.columns
        if column.name not in exclude
    }


def ensure_project_reference_data(
    db: Session,
    project_id: uuid.UUID,
    *,
    remap_existing_graph: bool = False,
) -> None:
    """Clone legacy global templates into one project's isolated namespace.

    The operation is idempotent per reference family and never commits, so a
    project creation or migration can include it in its own transaction.
    """

    relation_map: dict[uuid.UUID, uuid.UUID] = {}
    if db.query(models.RelationStyle).filter(models.RelationStyle.project_id == project_id).first() is None:
        templates = db.query(models.RelationStyle).filter(models.RelationStyle.project_id.is_(None)).all()
        if templates:
            for template in templates:
                created = models.RelationStyle(
                    project_id=project_id,
                    **_copy_columns(template, exclude={"id", "project_id", "created_at", "updated_at"}),
                )
                db.add(created)
                db.flush()
                relation_map[template.id] = created.id
        else:
            ensure_default_relation_styles(db, project_id)

    preset_map: dict[uuid.UUID, uuid.UUID] = {}
    if db.query(models.BoxPreset).filter(models.BoxPreset.project_id == project_id).first() is None:
        templates = db.query(models.BoxPreset).filter(models.BoxPreset.project_id.is_(None)).all()
        if templates:
            for template in templates:
                created = models.BoxPreset(
                    project_id=project_id,
                    **_copy_columns(template, exclude={"id", "project_id", "created_at", "updated_at"}),
                )
                db.add(created)
                db.flush()
                preset_map[template.id] = created.id
        else:
            ensure_default_box_presets(db, project_id)

    layout_type_map: dict[uuid.UUID, uuid.UUID] = {}
    if db.query(models.KeyLayoutType).filter(models.KeyLayoutType.project_id == project_id).first() is None:
        for template in db.query(models.KeyLayoutType).filter(models.KeyLayoutType.project_id.is_(None)).all():
            created = models.KeyLayoutType(
                project_id=project_id,
                **_copy_columns(template, exclude={"id", "project_id", "created_at", "updated_at"}),
            )
            db.add(created)
            db.flush()
            layout_type_map[template.id] = created.id

    for model in (models.KeyDrawingType, models.KeyShape):
        if db.query(model).filter(model.project_id == project_id).first() is not None:
            continue
        for template in db.query(model).filter(model.project_id.is_(None)).all():
            db.add(
                model(
                    project_id=project_id,
                    **_copy_columns(template, exclude={"id", "project_id", "created_at", "updated_at"}),
                )
            )

    if db.query(models.LayerMaster).filter(models.LayerMaster.project_id == project_id).first() is None:
        for template in db.query(models.LayerMaster).filter(models.LayerMaster.project_id.is_(None)).all():
            created = models.LayerMaster(
                project_id=project_id,
                **_copy_columns(template, exclude={"id", "project_id", "created_at", "updated_at"}),
            )
            db.add(created)
            db.flush()
            for priority in template.priorities:
                mapped_layout_id = layout_type_map.get(priority.key_layout_type_id)
                if mapped_layout_id is not None:
                    db.add(
                        models.LayerMasterPriority(
                            project_id=project_id,
                            layer_master_id=created.id,
                            key_layout_type_id=mapped_layout_id,
                            value=priority.value,
                        )
                    )

    if remap_existing_graph:
        if preset_map:
            for layer in db.query(models.Layer).filter(models.Layer.project_id == project_id).all():
                if layer.box_preset_id in preset_map:
                    layer.box_preset_id = preset_map[layer.box_preset_id]
        if relation_map:
            for relation in db.query(models.LayerRelation).filter(models.LayerRelation.project_id == project_id).all():
                if relation.relation_style_id in relation_map:
                    relation.relation_style_id = relation_map[relation.relation_style_id]
    db.flush()
