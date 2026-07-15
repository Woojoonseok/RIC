from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db


router = APIRouter(prefix="/api/layer-master", tags=["layer-master"])


def _serialize(row: models.LayerMaster) -> schemas.LayerMasterRead:
    return schemas.LayerMasterRead(
        id=row.id,
        name=row.name,
        layer_number=row.layer_number,
        mask_main_fld=row.mask_main_fld,
        mask_sl_fld=row.mask_sl_fld,
        pr_wf=row.pr_wf,
        dev_wf=row.dev_wf,
        pr_type=row.pr_type,
        light_source=row.light_source,
        pr_open_close=row.pr_open_close,
        validation_rule=row.validation_rule,
        comment=row.comment,
        priorities={str(item.key_layout_type_id): item.value for item in row.priority_rows},
    )


def _get(db: Session, row_id: uuid.UUID) -> models.LayerMaster:
    row = db.get(models.LayerMaster, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer Master not found")
    return row


def _set_priorities(db: Session, row: models.LayerMaster, priorities: dict[str, str | None]) -> None:
    db.query(models.LayerMasterPriority).filter(models.LayerMasterPriority.layer_master_id == row.id).delete()
    for raw_id, value in priorities.items():
        try:
            key_layout_type_id = uuid.UUID(raw_id)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"Invalid Key Layout Type id: {raw_id}") from exc
        if db.get(models.KeyLayoutType, key_layout_type_id) is None:
            raise HTTPException(status_code=422, detail=f"Key Layout Type not found: {raw_id}")
        db.add(models.LayerMasterPriority(
            layer_master_id=row.id, key_layout_type_id=key_layout_type_id, value=value
        ))


@router.get("", response_model=list[schemas.LayerMasterRead])
def list_layer_masters(db: Session = Depends(get_db)):
    return [_serialize(row) for row in db.query(models.LayerMaster).order_by(models.LayerMaster.name).all()]


@router.post("", response_model=schemas.LayerMasterRead, status_code=status.HTTP_201_CREATED)
def create_layer_master(payload: schemas.LayerMasterCreate, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude={"priorities"})
    row = models.LayerMaster(**data)
    db.add(row)
    try:
        db.flush()
        _set_priorities(db, row, payload.priorities)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Layer Master name already exists") from exc
    db.refresh(row)
    return _serialize(row)


@router.put("/{row_id}", response_model=schemas.LayerMasterRead)
def update_layer_master(row_id: uuid.UUID, payload: schemas.LayerMasterUpdate, db: Session = Depends(get_db)):
    row = _get(db, row_id)
    data = payload.model_dump(exclude={"priorities"}, exclude_unset=True)
    for field, value in data.items():
        setattr(row, field, value)
    if "priorities" in payload.model_fields_set and payload.priorities is not None:
        _set_priorities(db, row, payload.priorities)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Layer Master name already exists") from exc
    db.refresh(row)
    return _serialize(row)


@router.delete("/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_layer_master(row_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    db.delete(_get(db, row_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
