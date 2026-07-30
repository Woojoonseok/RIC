from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.project_access import ProjectContext, get_project_context, project_request_guard
from ..services.layer_master_sync import delete_layer_master_layers, sync_layer_master

router = APIRouter(
    prefix="/api/projects/{project_id}/layer-master",
    tags=["project layer master"],
    dependencies=[Depends(project_request_guard)],
)


def _snapshot(row: models.LayerMaster) -> dict[str, object]:
    excluded = {"id", "project_id", "created_at", "updated_at"}
    values: dict[str, object] = {
        column.name: getattr(row, column.name)
        for column in row.__table__.columns
        if column.name not in excluded
    }
    values["priorities"] = {
        str(priority.key_layout_type_id): priority.value for priority in row.priorities
    }
    return values


def _serialize(row: models.LayerMaster) -> schemas.LayerMasterRead:
    return schemas.LayerMasterRead(
        id=row.id,
        project_id=row.project_id,
        name=row.name,
        layer_number=row.layer_number,
        mask_main_fld=row.mask_main_fld,
        mask_sl_fld=row.mask_sl_fld,
        pr_wf=row.pr_wf,
        dev_wf=row.dev_wf,
        pr_type=row.pr_type,
        light_source=row.light_source,
        pr_open_close=row.pr_open_close,
        group=row.group,
        validation_rule=row.validation_rule,
        comment=row.comment,
        priorities={priority.key_layout_type_id: priority.value for priority in row.priorities},
    )


def _row_or_404(db: Session, project_id: uuid.UUID, row_id: uuid.UUID) -> models.LayerMaster:
    row = db.get(models.LayerMaster, row_id)
    if row is None or row.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Layer master not found")
    return row


def _apply_priorities(
    db: Session,
    project_id: uuid.UUID,
    row: models.LayerMaster,
    priorities: dict[uuid.UUID, str | None],
) -> None:
    valid_type_ids = {
        item.id for item in db.query(models.KeyLayoutType).filter(models.KeyLayoutType.project_id == project_id).all()
    }
    unknown = set(priorities) - valid_type_ids
    if unknown:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown project key layout type")
    existing = {priority.key_layout_type_id: priority for priority in row.priorities}
    for type_id in valid_type_ids:
        priority = existing.get(type_id)
        if priority is None:
            db.add(
                models.LayerMasterPriority(
                    project_id=project_id,
                    layer_master_id=row.id,
                    key_layout_type_id=type_id,
                    value=priorities.get(type_id),
                )
            )
        elif type_id in priorities:
            priority.value = priorities[type_id]


@router.get("", response_model=list[schemas.LayerMasterRead])
def list_layer_masters(project_id: uuid.UUID, db: Session = Depends(get_db)) -> list[schemas.LayerMasterRead]:
    rows = (
        db.query(models.LayerMaster)
        .filter(models.LayerMaster.project_id == project_id)
        .order_by(models.LayerMaster.created_at, models.LayerMaster.id)
        .all()
    )
    return [_serialize(row) for row in rows]


@router.post("", response_model=schemas.LayerMasterRead, status_code=status.HTTP_201_CREATED)
def create_layer_master(
    project_id: uuid.UUID,
    payload: schemas.LayerMasterCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.LayerMasterRead:
    data = payload.model_dump(exclude={"priorities"})
    data["layer_number"] = payload.layer_number.strip()
    if not data["layer_number"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Layer number is required",
        )
    row = models.LayerMaster(project_id=project_id, **data)
    db.add(row)
    try:
        db.flush()
        _apply_priorities(db, project_id, row, payload.priorities)
        db.flush()
        db.expire(row, ["priorities"])
        record_project_event(
            db,
            project_id=project_id,
            actor=context.actor,
            event_type="layer_master.created",
            target_type="layer_master",
            target_id=row.id,
            summary=f"Created Layer Master {row.name}",
            details={"values": _snapshot(row)},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Layer master name already exists") from exc
    db.refresh(row)
    return _serialize(row)


@router.put("/{row_id}", response_model=schemas.LayerMasterRead)
def update_layer_master(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    payload: schemas.LayerMasterUpdate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.LayerMasterRead:
    row = _row_or_404(db, project_id, row_id)
    before = _snapshot(row)
    data = payload.model_dump(exclude={"priorities"}, exclude_unset=True)
    if "layer_number" in data:
        data["layer_number"] = (data["layer_number"] or "").strip()
        if not data["layer_number"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Layer number is required",
            )
    for field, value in data.items():
        setattr(row, field, value)
    if payload.priorities is not None:
        _apply_priorities(db, project_id, row, payload.priorities)
    try:
        db.flush()
        db.expire(row, ["priorities"])
        after = _snapshot(row)
        if before == after:
            db.commit()
            db.refresh(row)
            return _serialize(row)
        sync_layer_master(
            db,
            row,
            sync_group=before.get("group") != after.get("group"),
            create_missing=False,
        )
        record_project_event(
            db,
            project_id=project_id,
            actor=context.actor,
            event_type="layer_master.updated",
            target_type="layer_master",
            target_id=row.id,
            summary=f"Updated Layer Master {row.name}",
            details={"before": before, "after": after},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Layer master name already exists") from exc
    db.refresh(row)
    return _serialize(row)


@router.delete("/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_layer_master(
    project_id: uuid.UUID,
    row_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> None:
    row = _row_or_404(db, project_id, row_id)
    label = row.name
    snapshot = _snapshot(row)
    delete_layer_master_layers(db, row)
    db.delete(row)
    record_project_event(
        db,
        project_id=project_id,
        actor=context.actor,
        event_type="layer_master.deleted",
        target_type="layer_master",
        target_id=row.id,
        summary=f"Deleted Layer Master {label}",
        details={"values": snapshot},
    )
    db.commit()
