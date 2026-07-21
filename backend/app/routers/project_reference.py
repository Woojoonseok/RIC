from __future__ import annotations

import uuid
from typing import Any, TypeVar

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.project_access import ProjectContext, get_project_context, project_request_guard

router = APIRouter(
    prefix="/api/projects/{project_id}/reference",
    tags=["project reference"],
    dependencies=[Depends(project_request_guard)],
)

ModelT = TypeVar("ModelT")


def _reference_snapshot(row: Any) -> dict[str, Any]:
    excluded = {"id", "project_id", "created_at", "updated_at"}
    return {
        column.name: getattr(row, column.name)
        for column in row.__table__.columns
        if column.name not in excluded
    }


def _flush_unique(db: Session, message: str) -> None:
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message) from exc


def _scoped_row(db: Session, model: type[ModelT], project_id: uuid.UUID, row_id: uuid.UUID) -> ModelT:
    row = db.get(model, row_id)
    if row is None or getattr(row, "project_id", None) != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference row not found")
    return row


def _commit_unique(db: Session, message: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message) from exc


def _audit_reference(
    db: Session,
    context: ProjectContext,
    action: str,
    resource: str,
    row_id: uuid.UUID,
    name: str,
    details: dict[str, Any] | None = None,
) -> None:
    record_project_event(
        db,
        project_id=context.project.id,
        actor=context.actor,
        event_type=f"reference.{resource}.{action}",
        target_type=resource,
        target_id=row_id,
        summary=f"{action.title()} {resource} {name}",
        details=details,
    )


@router.get("/key-layout-types", response_model=list[schemas.KeyLayoutTypeRead])
def list_key_layout_types(project_id: uuid.UUID, db: Session = Depends(get_db)):
    return (
        db.query(models.KeyLayoutType)
        .filter(models.KeyLayoutType.project_id == project_id)
        .order_by(models.KeyLayoutType.sort_order, models.KeyLayoutType.created_at)
        .all()
    )


@router.post("/key-layout-types", response_model=schemas.KeyLayoutTypeRead, status_code=status.HTTP_201_CREATED)
def create_key_layout_type(
    project_id: uuid.UUID,
    payload: schemas.KeyLayoutTypeCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
):
    row = models.KeyLayoutType(project_id=project_id, **payload.model_dump())
    db.add(row)
    _flush_unique(db, "Key layout type already exists")
    for master in db.query(models.LayerMaster).filter(models.LayerMaster.project_id == project_id).all():
        db.add(
            models.LayerMasterPriority(
                project_id=project_id,
                layer_master_id=master.id,
                key_layout_type_id=row.id,
                value=None,
            )
        )
    _audit_reference(
        db,
        context,
        "created",
        "key_layout_type",
        row.id,
        row.name,
        {"values": _reference_snapshot(row)},
    )
    _commit_unique(db, "Key layout type already exists")
    db.refresh(row)
    return row


@router.put("/key-layout-types/{row_id}", response_model=schemas.KeyLayoutTypeRead)
def update_key_layout_type(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    payload: schemas.KeyLayoutTypeUpdate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
):
    row = _scoped_row(db, models.KeyLayoutType, project_id, row_id)
    before = _reference_snapshot(row)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    _audit_reference(
        db,
        context,
        "updated",
        "key_layout_type",
        row.id,
        row.name,
        {"before": before, "after": _reference_snapshot(row)},
    )
    _commit_unique(db, "Key layout type already exists")
    db.refresh(row)
    return row


@router.delete("/key-layout-types/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key_layout_type(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> None:
    row = _scoped_row(db, models.KeyLayoutType, project_id, row_id)
    snapshot = _reference_snapshot(row)
    db.query(models.LayerMasterPriority).filter(
        models.LayerMasterPriority.project_id == project_id,
        models.LayerMasterPriority.key_layout_type_id == row.id,
    ).delete(synchronize_session=False)
    name = row.name
    db.delete(row)
    _audit_reference(db, context, "deleted", "key_layout_type", row.id, name, {"values": snapshot})
    db.commit()


@router.get("/key-drawing-types", response_model=list[schemas.KeyDrawingTypeRead])
def list_key_drawing_types(project_id: uuid.UUID, db: Session = Depends(get_db)):
    return (
        db.query(models.KeyDrawingType)
        .filter(models.KeyDrawingType.project_id == project_id)
        .order_by(models.KeyDrawingType.sort_order, models.KeyDrawingType.created_at)
        .all()
    )


@router.post("/key-drawing-types", response_model=schemas.KeyDrawingTypeRead, status_code=status.HTTP_201_CREATED)
def create_key_drawing_type(
    project_id: uuid.UUID,
    payload: schemas.KeyDrawingTypeCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
):
    row = models.KeyDrawingType(project_id=project_id, **payload.model_dump())
    db.add(row)
    db.flush()
    _audit_reference(
        db,
        context,
        "created",
        "key_drawing_type",
        row.id,
        row.symbol or row.key_shape or str(row.id),
        {"values": _reference_snapshot(row)},
    )
    db.commit()
    db.refresh(row)
    return row


@router.put("/key-drawing-types/{row_id}", response_model=schemas.KeyDrawingTypeRead)
def update_key_drawing_type(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    payload: schemas.KeyDrawingTypeUpdate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
):
    row = _scoped_row(db, models.KeyDrawingType, project_id, row_id)
    before = _reference_snapshot(row)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    _audit_reference(
        db,
        context,
        "updated",
        "key_drawing_type",
        row.id,
        row.symbol or row.key_shape or str(row.id),
        {"before": before, "after": _reference_snapshot(row)},
    )
    db.commit()
    db.refresh(row)
    return row


@router.delete("/key-drawing-types/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key_drawing_type(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> None:
    row = _scoped_row(db, models.KeyDrawingType, project_id, row_id)
    snapshot = _reference_snapshot(row)
    label = row.symbol or row.key_shape or str(row.id)
    db.delete(row)
    _audit_reference(db, context, "deleted", "key_drawing_type", row.id, label, {"values": snapshot})
    db.commit()


@router.get("/key-shapes", response_model=list[schemas.KeyShapeRead])
def list_key_shapes(project_id: uuid.UUID, db: Session = Depends(get_db)):
    return (
        db.query(models.KeyShape)
        .filter(models.KeyShape.project_id == project_id)
        .order_by(models.KeyShape.sort_order, models.KeyShape.created_at)
        .all()
    )


@router.post("/key-shapes", response_model=schemas.KeyShapeRead, status_code=status.HTTP_201_CREATED)
def create_key_shape(
    project_id: uuid.UUID,
    payload: schemas.KeyShapeCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
):
    row = models.KeyShape(project_id=project_id, **payload.model_dump())
    db.add(row)
    _flush_unique(db, "Key shape already exists")
    _audit_reference(
        db, context, "created", "key_shape", row.id, row.key_shape, {"values": _reference_snapshot(row)}
    )
    _commit_unique(db, "Key shape already exists")
    db.refresh(row)
    return row


@router.put("/key-shapes/{row_id}", response_model=schemas.KeyShapeRead)
def update_key_shape(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    payload: schemas.KeyShapeUpdate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
):
    row = _scoped_row(db, models.KeyShape, project_id, row_id)
    before = _reference_snapshot(row)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    _audit_reference(
        db,
        context,
        "updated",
        "key_shape",
        row.id,
        row.key_shape,
        {"before": before, "after": _reference_snapshot(row)},
    )
    _commit_unique(db, "Key shape already exists")
    db.refresh(row)
    return row


@router.delete("/key-shapes/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key_shape(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> None:
    row = _scoped_row(db, models.KeyShape, project_id, row_id)
    snapshot = _reference_snapshot(row)
    label = row.key_shape
    db.delete(row)
    _audit_reference(db, context, "deleted", "key_shape", row.id, label, {"values": snapshot})
    db.commit()


@router.get("/relation-styles", response_model=list[schemas.RelationStyleRead])
def list_relation_styles(project_id: uuid.UUID, db: Session = Depends(get_db)):
    return (
        db.query(models.RelationStyle)
        .filter(models.RelationStyle.project_id == project_id)
        .order_by(models.RelationStyle.sort_order, models.RelationStyle.created_at)
        .all()
    )


@router.post("/relation-styles", response_model=schemas.RelationStyleRead, status_code=status.HTTP_201_CREATED)
def create_relation_style(
    project_id: uuid.UUID,
    payload: schemas.RelationStyleCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
):
    row = models.RelationStyle(project_id=project_id, **payload.model_dump())
    db.add(row)
    _flush_unique(db, "Relation style already exists")
    _audit_reference(
        db,
        context,
        "created",
        "relation_style",
        row.id,
        row.name,
        {"values": _reference_snapshot(row)},
    )
    _commit_unique(db, "Relation style already exists")
    db.refresh(row)
    return row


@router.put("/relation-styles/{row_id}", response_model=schemas.RelationStyleRead)
def update_relation_style(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    payload: schemas.RelationStyleUpdate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
):
    row = _scoped_row(db, models.RelationStyle, project_id, row_id)
    before = _reference_snapshot(row)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    _audit_reference(
        db,
        context,
        "updated",
        "relation_style",
        row.id,
        row.name,
        {"before": before, "after": _reference_snapshot(row)},
    )
    _commit_unique(db, "Relation style already exists")
    db.refresh(row)
    return row


@router.delete("/relation-styles/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_relation_style(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> None:
    row = _scoped_row(db, models.RelationStyle, project_id, row_id)
    snapshot = _reference_snapshot(row)
    if db.query(models.LayerRelation).filter(
        models.LayerRelation.project_id == project_id, models.LayerRelation.relation_style_id == row.id
    ).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Relation style is in use")
    label = row.name
    db.delete(row)
    _audit_reference(db, context, "deleted", "relation_style", row.id, label, {"values": snapshot})
    db.commit()


@router.get("/box-presets", response_model=list[schemas.BoxPresetRead])
def list_box_presets(project_id: uuid.UUID, db: Session = Depends(get_db)):
    return (
        db.query(models.BoxPreset)
        .filter(models.BoxPreset.project_id == project_id)
        .order_by(models.BoxPreset.sort_order, models.BoxPreset.created_at)
        .all()
    )


@router.post("/box-presets", response_model=schemas.BoxPresetRead, status_code=status.HTTP_201_CREATED)
def create_box_preset(
    project_id: uuid.UUID,
    payload: schemas.BoxPresetCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
):
    data = payload.model_dump()
    if data["is_default"]:
        db.query(models.BoxPreset).filter(models.BoxPreset.project_id == project_id).update(
            {models.BoxPreset.is_default: False}, synchronize_session=False
        )
    row = models.BoxPreset(project_id=project_id, **data)
    db.add(row)
    _flush_unique(db, "Box preset already exists")
    _audit_reference(
        db, context, "created", "box_preset", row.id, row.name, {"values": _reference_snapshot(row)}
    )
    _commit_unique(db, "Box preset already exists")
    db.refresh(row)
    return row


@router.put("/box-presets/{row_id}", response_model=schemas.BoxPresetRead)
def update_box_preset(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    payload: schemas.BoxPresetUpdate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
):
    row = _scoped_row(db, models.BoxPreset, project_id, row_id)
    before = _reference_snapshot(row)
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_default"):
        db.query(models.BoxPreset).filter(
            models.BoxPreset.project_id == project_id, models.BoxPreset.id != row.id
        ).update({models.BoxPreset.is_default: False}, synchronize_session=False)
    for field, value in data.items():
        setattr(row, field, value)
    _audit_reference(
        db,
        context,
        "updated",
        "box_preset",
        row.id,
        row.name,
        {"before": before, "after": _reference_snapshot(row)},
    )
    _commit_unique(db, "Box preset already exists")
    db.refresh(row)
    return row


@router.delete("/box-presets/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_box_preset(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> None:
    row = _scoped_row(db, models.BoxPreset, project_id, row_id)
    snapshot = _reference_snapshot(row)
    if db.query(models.Layer).filter(models.Layer.project_id == project_id, models.Layer.box_preset_id == row.id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Box preset is in use")
    label = row.name
    db.delete(row)
    _audit_reference(db, context, "deleted", "box_preset", row.id, label, {"values": snapshot})
    db.commit()
