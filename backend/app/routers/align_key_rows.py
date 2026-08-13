from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.project_access import ProjectContext, get_project_context, project_request_guard

router = APIRouter(
    prefix="/api/projects/{project_id}/align-key-rows",
    tags=["align key rows"],
    dependencies=[Depends(project_request_guard)],
)


def _row_or_404(db: Session, project_id: uuid.UUID, row_id: uuid.UUID) -> models.AlignKeyRow:
    row = db.get(models.AlignKeyRow, row_id)
    if row is None or row.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Align key row not found")
    return row


@router.get("", response_model=list[schemas.AlignKeyRowRead])
def list_rows(project_id: uuid.UUID, db: Session = Depends(get_db)) -> list[models.AlignKeyRow]:
    return (
        db.query(models.AlignKeyRow)
        .filter(models.AlignKeyRow.project_id == project_id)
        .order_by(models.AlignKeyRow.sort_order, models.AlignKeyRow.created_at, models.AlignKeyRow.id)
        .all()
    )


@router.post("", response_model=schemas.AlignKeyRowRead, status_code=status.HTTP_201_CREATED)
def create_row(
    project_id: uuid.UUID,
    payload: schemas.AlignKeyRowCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> models.AlignKeyRow:
    row = models.AlignKeyRow(project_id=project_id, **payload.model_dump())
    db.add(row)
    db.flush()
    record_project_event(
        db, project_id=project_id, actor=context.actor, event_type="align_key_row.created",
        target_type="align_key_row", target_id=row.id, summary="Align Key 행 추가",
        details={"values": payload.model_dump()},
    )
    db.commit()
    db.refresh(row)
    return row


@router.put("/{row_id}", response_model=schemas.AlignKeyRowRead)
def update_row(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    payload: schemas.AlignKeyRowUpdate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> models.AlignKeyRow:
    row = _row_or_404(db, project_id, row_id)
    before = {field: getattr(row, field) for field in payload.model_fields_set}
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    after = {field: getattr(row, field) for field in payload.model_fields_set}
    if before != after:
        record_project_event(
            db, project_id=project_id, actor=context.actor, event_type="align_key_row.updated",
            target_type="align_key_row", target_id=row.id, summary="Align Key 행 수정",
            details={"before": before, "after": after},
        )
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_row(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> None:
    row = _row_or_404(db, project_id, row_id)
    db.delete(row)
    record_project_event(
        db, project_id=project_id, actor=context.actor, event_type="align_key_row.deleted",
        target_type="align_key_row", target_id=row.id, summary="Align Key 행 삭제", details={},
    )
    db.commit()
