from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.box_presets import ensure_default_box_presets
from ..services.relation_styles import ensure_default_relation_styles


router = APIRouter(prefix="/api/reference", tags=["reference"])


def _commit(db: Session, message: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message) from exc


def _row_or_404(db: Session, model, row_id: uuid.UUID, label: str):
    row = db.get(model, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return row


@router.get("/key-layout-types", response_model=list[schemas.KeyLayoutTypeRead])
def list_key_layout_types(db: Session = Depends(get_db)):
    return db.query(models.KeyLayoutType).order_by(models.KeyLayoutType.sort_order, models.KeyLayoutType.name).all()


@router.post("/key-layout-types", response_model=schemas.KeyLayoutTypeRead, status_code=status.HTTP_201_CREATED)
def create_key_layout_type(payload: schemas.KeyLayoutTypeCreate, db: Session = Depends(get_db)):
    row = models.KeyLayoutType(**payload.model_dump())
    db.add(row)
    _commit(db, "Key Layout Type name already exists")
    db.refresh(row)
    return row


@router.put("/key-layout-types/{row_id}", response_model=schemas.KeyLayoutTypeRead)
def update_key_layout_type(row_id: uuid.UUID, payload: schemas.KeyLayoutTypeUpdate, db: Session = Depends(get_db)):
    row = _row_or_404(db, models.KeyLayoutType, row_id, "Key Layout Type")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    _commit(db, "Key Layout Type name already exists")
    db.refresh(row)
    return row


@router.delete("/key-layout-types/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key_layout_type(row_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    row = _row_or_404(db, models.KeyLayoutType, row_id, "Key Layout Type")
    db.query(models.LayerMasterPriority).filter(models.LayerMasterPriority.key_layout_type_id == row_id).delete()
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/key-drawing-types", response_model=list[schemas.KeyDrawingTypeRead])
def list_key_drawing_types(db: Session = Depends(get_db)):
    return db.query(models.KeyDrawingType).order_by(models.KeyDrawingType.sort_order, models.KeyDrawingType.id).all()


@router.post("/key-drawing-types", response_model=schemas.KeyDrawingTypeRead, status_code=status.HTTP_201_CREATED)
def create_key_drawing_type(payload: schemas.KeyDrawingTypeCreate, db: Session = Depends(get_db)):
    row = models.KeyDrawingType(**payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/key-drawing-types/{row_id}", response_model=schemas.KeyDrawingTypeRead)
def update_key_drawing_type(row_id: uuid.UUID, payload: schemas.KeyDrawingTypeUpdate, db: Session = Depends(get_db)):
    row = _row_or_404(db, models.KeyDrawingType, row_id, "Key Drawing Type")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/key-drawing-types/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key_drawing_type(row_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    db.delete(_row_or_404(db, models.KeyDrawingType, row_id, "Key Drawing Type"))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/key-shapes", response_model=list[schemas.KeyShapeRead])
def list_key_shapes(db: Session = Depends(get_db)):
    return db.query(models.KeyShape).order_by(models.KeyShape.sort_order, models.KeyShape.key_shape).all()


@router.post("/key-shapes", response_model=schemas.KeyShapeRead, status_code=status.HTTP_201_CREATED)
def create_key_shape(payload: schemas.KeyShapeCreate, db: Session = Depends(get_db)):
    row = models.KeyShape(**payload.model_dump())
    db.add(row)
    _commit(db, "Key Shape already exists")
    db.refresh(row)
    return row


@router.put("/key-shapes/{row_id}", response_model=schemas.KeyShapeRead)
def update_key_shape(row_id: uuid.UUID, payload: schemas.KeyShapeUpdate, db: Session = Depends(get_db)):
    row = _row_or_404(db, models.KeyShape, row_id, "Key Shape")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    _commit(db, "Key Shape already exists")
    db.refresh(row)
    return row


@router.delete("/key-shapes/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key_shape(row_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    db.delete(_row_or_404(db, models.KeyShape, row_id, "Key Shape"))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/relation-styles", response_model=list[schemas.RelationStyleRead])
def list_relation_styles(db: Session = Depends(get_db)):
    return ensure_default_relation_styles(db)


@router.post("/relation-styles", response_model=schemas.RelationStyleRead, status_code=status.HTTP_201_CREATED)
def create_relation_style(payload: schemas.RelationStyleCreate, db: Session = Depends(get_db)):
    row = models.RelationStyle(**payload.model_dump())
    db.add(row)
    _commit(db, "Relation Style name already exists")
    db.refresh(row)
    return row


@router.put("/relation-styles/{row_id}", response_model=schemas.RelationStyleRead)
def update_relation_style(row_id: uuid.UUID, payload: schemas.RelationStyleUpdate, db: Session = Depends(get_db)):
    row = _row_or_404(db, models.RelationStyle, row_id, "Relation Style")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    _commit(db, "Relation Style name already exists")
    db.refresh(row)
    return row


@router.delete("/relation-styles/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_relation_style(row_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    row = _row_or_404(db, models.RelationStyle, row_id, "Relation Style")
    db.query(models.LayerRelation).filter(models.LayerRelation.relation_style_id == row_id).update(
        {"relation_style_id": None}
    )
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/box-presets", response_model=list[schemas.BoxPresetRead])
def list_box_presets(db: Session = Depends(get_db)):
    return ensure_default_box_presets(db)


@router.post("/box-presets", response_model=schemas.BoxPresetRead, status_code=status.HTTP_201_CREATED)
def create_box_preset(payload: schemas.BoxPresetCreate, db: Session = Depends(get_db)):
    if payload.is_default:
        db.query(models.BoxPreset).update({"is_default": False})
    row = models.BoxPreset(**payload.model_dump())
    db.add(row)
    _commit(db, "Box Preset name already exists")
    db.refresh(row)
    return row


@router.put("/box-presets/{row_id}", response_model=schemas.BoxPresetRead)
def update_box_preset(row_id: uuid.UUID, payload: schemas.BoxPresetUpdate, db: Session = Depends(get_db)):
    row = _row_or_404(db, models.BoxPreset, row_id, "Box Preset")
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_default") is True:
        db.query(models.BoxPreset).filter(models.BoxPreset.id != row_id).update({"is_default": False})
    for field, value in data.items():
        setattr(row, field, value)
    _commit(db, "Box Preset name already exists")
    db.refresh(row)
    return row


@router.delete("/box-presets/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_box_preset(row_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    row = _row_or_404(db, models.BoxPreset, row_id, "Box Preset")
    was_default = row.is_default
    db.query(models.Layer).filter(models.Layer.box_preset_id == row_id).update({"box_preset_id": None})
    db.delete(row)
    db.flush()
    if was_default:
        next_row = db.query(models.BoxPreset).order_by(models.BoxPreset.sort_order, models.BoxPreset.name).first()
        if next_row:
            next_row.is_default = True
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
