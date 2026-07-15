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
        priorities={p.key_layout_type_id: p.value for p in row.priorities},
    )


def _apply_priorities(db: Session, row: models.LayerMaster, priorities: dict[uuid.UUID, str | None]) -> None:
    if not priorities:
        return
    valid_type_ids = {row.id for row in db.query(models.KeyLayoutType.id).all()}
    unknown = set(priorities) - valid_type_ids
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown key layout type id(s): {', '.join(str(u) for u in unknown)}",
        )
    existing = {p.key_layout_type_id: p for p in row.priorities}
    for type_id, value in priorities.items():
        entry = existing.get(type_id)
        if entry is None:
            db.add(models.LayerMasterPriority(layer_master_id=row.id, key_layout_type_id=type_id, value=value))
        else:
            entry.value = value


@router.get("", response_model=list[schemas.LayerMasterRead])
def list_layer_masters(db: Session = Depends(get_db)) -> list[schemas.LayerMasterRead]:
    rows = db.query(models.LayerMaster).order_by(models.LayerMaster.created_at).all()
    return [_serialize(row) for row in rows]


@router.post("", response_model=schemas.LayerMasterRead, status_code=status.HTTP_201_CREATED)
def create_layer_master(payload: schemas.LayerMasterCreate, db: Session = Depends(get_db)) -> schemas.LayerMasterRead:
    data = payload.model_dump(exclude={"priorities"})
    row = models.LayerMaster(**data)
    db.add(row)
    try:
        db.flush()
        _apply_priorities(db, row, payload.priorities)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Layer name already exists") from exc
    db.refresh(row)
    return _serialize(row)


@router.put("/{row_id}", response_model=schemas.LayerMasterRead)
def update_layer_master(row_id: uuid.UUID, payload: schemas.LayerMasterUpdate, db: Session = Depends(get_db)) -> schemas.LayerMasterRead:
    row = db.get(models.LayerMaster, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer master not found")
    data = payload.model_dump(exclude_unset=True, exclude={"priorities"})
    for field, value in data.items():
        setattr(row, field, value)
    try:
        if payload.priorities is not None:
            _apply_priorities(db, row, payload.priorities)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Layer name already exists") from exc
    db.refresh(row)
    return _serialize(row)


@router.delete("/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_layer_master(row_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    row = db.get(models.LayerMaster, row_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer master not found")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
