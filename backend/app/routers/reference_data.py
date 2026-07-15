from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/reference", tags=["reference"])


# --- Key Layout Type ------------------------------------------------------

@router.get("/key-layout-types", response_model=list[schemas.KeyLayoutTypeRead])
def list_key_layout_types(db: Session = Depends(get_db)) -> list[models.KeyLayoutType]:
    return (
        db.query(models.KeyLayoutType)
        .order_by(models.KeyLayoutType.sort_order, models.KeyLayoutType.created_at)
        .all()
    )


@router.post("/key-layout-types", response_model=schemas.KeyLayoutTypeRead, status_code=status.HTTP_201_CREATED)
def create_key_layout_type(payload: schemas.KeyLayoutTypeCreate, db: Session = Depends(get_db)) -> models.KeyLayoutType:
    row = models.KeyLayoutType(**payload.model_dump())
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Key layout type name already exists") from exc
    db.refresh(row)
    return row


@router.put("/key-layout-types/{row_id}", response_model=schemas.KeyLayoutTypeRead)
def update_key_layout_type(row_id: uuid.UUID, payload: schemas.KeyLayoutTypeUpdate, db: Session = Depends(get_db)) -> models.KeyLayoutType:
    row = db.get(models.KeyLayoutType, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key layout type not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Key layout type name already exists") from exc
    db.refresh(row)
    return row


@router.delete("/key-layout-types/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key_layout_type(row_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    row = db.get(models.KeyLayoutType, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key layout type not found")
    # SQLite doesn't enforce ON DELETE CASCADE unless foreign_keys=ON is set
    # per-connection, so drop the dependent "Layer의 우선순위" cells explicitly
    # rather than relying on the DB to cascade them.
    db.query(models.LayerMasterPriority).filter(models.LayerMasterPriority.key_layout_type_id == row_id).delete(
        synchronize_session=False
    )
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# --- Key Drawing Type ------------------------------------------------------

@router.get("/key-drawing-types", response_model=list[schemas.KeyDrawingTypeRead])
def list_key_drawing_types(db: Session = Depends(get_db)) -> list[models.KeyDrawingType]:
    return (
        db.query(models.KeyDrawingType)
        .order_by(models.KeyDrawingType.sort_order, models.KeyDrawingType.created_at)
        .all()
    )


@router.post("/key-drawing-types", response_model=schemas.KeyDrawingTypeRead, status_code=status.HTTP_201_CREATED)
def create_key_drawing_type(payload: schemas.KeyDrawingTypeCreate, db: Session = Depends(get_db)) -> models.KeyDrawingType:
    row = models.KeyDrawingType(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/key-drawing-types/{row_id}", response_model=schemas.KeyDrawingTypeRead)
def update_key_drawing_type(row_id: uuid.UUID, payload: schemas.KeyDrawingTypeUpdate, db: Session = Depends(get_db)) -> models.KeyDrawingType:
    row = db.get(models.KeyDrawingType, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key drawing type not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/key-drawing-types/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key_drawing_type(row_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    row = db.get(models.KeyDrawingType, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key drawing type not found")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Key Shape --------------------------------------------------------------

@router.get("/key-shapes", response_model=list[schemas.KeyShapeRead])
def list_key_shapes(db: Session = Depends(get_db)) -> list[models.KeyShape]:
    return db.query(models.KeyShape).order_by(models.KeyShape.sort_order, models.KeyShape.created_at).all()


@router.post("/key-shapes", response_model=schemas.KeyShapeRead, status_code=status.HTTP_201_CREATED)
def create_key_shape(payload: schemas.KeyShapeCreate, db: Session = Depends(get_db)) -> models.KeyShape:
    row = models.KeyShape(**payload.model_dump())
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Key shape already exists") from exc
    db.refresh(row)
    return row


@router.put("/key-shapes/{row_id}", response_model=schemas.KeyShapeRead)
def update_key_shape(row_id: uuid.UUID, payload: schemas.KeyShapeUpdate, db: Session = Depends(get_db)) -> models.KeyShape:
    row = db.get(models.KeyShape, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key shape not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Key shape already exists") from exc
    db.refresh(row)
    return row


@router.delete("/key-shapes/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key_shape(row_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    row = db.get(models.KeyShape, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Key shape not found")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Relation Style (moved from per-project to global) --------------------

@router.get("/relation-styles", response_model=list[schemas.RelationStyleRead])
def list_relation_styles(db: Session = Depends(get_db)) -> list[models.RelationStyle]:
    return (
        db.query(models.RelationStyle)
        .order_by(models.RelationStyle.sort_order, models.RelationStyle.created_at)
        .all()
    )


@router.post("/relation-styles", response_model=schemas.RelationStyleRead, status_code=status.HTTP_201_CREATED)
def create_relation_style(payload: schemas.RelationStyleCreate, db: Session = Depends(get_db)) -> models.RelationStyle:
    relation_style = models.RelationStyle(**payload.model_dump())
    db.add(relation_style)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Relation style name already exists") from exc
    db.refresh(relation_style)
    return relation_style


@router.put("/relation-styles/{style_id}", response_model=schemas.RelationStyleRead)
def update_relation_style(style_id: uuid.UUID, payload: schemas.RelationStyleUpdate, db: Session = Depends(get_db)) -> models.RelationStyle:
    relation_style = db.get(models.RelationStyle, style_id)
    if relation_style is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relation style not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(relation_style, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Relation style name already exists") from exc
    db.refresh(relation_style)
    return relation_style


@router.delete("/relation-styles/{style_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_relation_style(style_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    relation_style = db.get(models.RelationStyle, style_id)
    if relation_style is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relation style not found")
    db.query(models.LayerRelation).filter(models.LayerRelation.relation_style_id == style_id).update(
        {"relation_style_id": None}
    )
    db.delete(relation_style)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Box Preset (moved from per-project to global) -------------------------

@router.get("/box-presets", response_model=list[schemas.BoxPresetRead])
def list_box_presets(db: Session = Depends(get_db)) -> list[models.BoxPreset]:
    return db.query(models.BoxPreset).order_by(models.BoxPreset.sort_order, models.BoxPreset.created_at).all()


@router.post("/box-presets", response_model=schemas.BoxPresetRead, status_code=status.HTTP_201_CREATED)
def create_box_preset(payload: schemas.BoxPresetCreate, db: Session = Depends(get_db)) -> models.BoxPreset:
    if payload.is_default:
        db.query(models.BoxPreset).update({"is_default": False})
    preset = models.BoxPreset(**payload.model_dump())
    db.add(preset)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Box preset name already exists") from exc
    db.refresh(preset)
    return preset


@router.put("/box-presets/{preset_id}", response_model=schemas.BoxPresetRead)
def update_box_preset(preset_id: uuid.UUID, payload: schemas.BoxPresetUpdate, db: Session = Depends(get_db)) -> models.BoxPreset:
    preset = db.get(models.BoxPreset, preset_id)
    if preset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Box preset not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_default") is True:
        db.query(models.BoxPreset).filter(models.BoxPreset.id != preset_id).update({"is_default": False})
    for field, value in data.items():
        setattr(preset, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Box preset name already exists") from exc
    db.refresh(preset)
    return preset


@router.delete("/box-presets/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_box_preset(preset_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    preset = db.get(models.BoxPreset, preset_id)
    if preset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Box preset not found")
    was_default = preset.is_default
    db.delete(preset)
    db.flush()
    if was_default:
        next_preset = (
            db.query(models.BoxPreset)
            .order_by(models.BoxPreset.sort_order, models.BoxPreset.created_at)
            .first()
        )
        if next_preset is not None:
            next_preset.is_default = True
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
