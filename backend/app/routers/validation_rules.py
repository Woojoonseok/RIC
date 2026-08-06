from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.project_access import ProjectContext, get_project_context, project_request_guard

router = APIRouter(
    prefix="/api/projects/{project_id}/reference/validation-rules",
    tags=["validation rules"],
    dependencies=[Depends(project_request_guard)],
)


def _row_or_404(db: Session, project_id: uuid.UUID, rule_id: uuid.UUID) -> models.ValidationRule:
    row = db.get(models.ValidationRule, rule_id)
    if row is None or row.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Validation rule not found")
    return row


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Validation rule name already exists") from exc


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Validation rule name already exists") from exc


def _audit(db: Session, context: ProjectContext, row: models.ValidationRule, action: str) -> None:
    record_project_event(
        db,
        project_id=context.project.id,
        actor=context.actor,
        event_type=f"validation_rule.{action}",
        target_type="validation_rule",
        target_id=row.id,
        summary=f"{action.title()} validation rule {row.name}",
        details={"values": {"name": row.name, "target_type": row.target_type, "rule_type": row.rule_type}},
    )


@router.get("", response_model=list[schemas.ValidationRuleRead])
def list_validation_rules(
    project_id: uuid.UUID,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> list[models.ValidationRule]:
    return (
        db.query(models.ValidationRule)
        .filter(models.ValidationRule.project_id == project_id)
        .order_by(models.ValidationRule.sort_order, models.ValidationRule.created_at)
        .all()
    )


@router.post("", response_model=schemas.ValidationRuleRead, status_code=status.HTTP_201_CREATED)
def create_validation_rule(
    project_id: uuid.UUID,
    payload: schemas.ValidationRuleCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> models.ValidationRule:
    row = models.ValidationRule(project_id=project_id, **payload.model_dump())
    db.add(row)
    _flush(db)
    _audit(db, context, row, "created")
    _commit(db)
    db.refresh(row)
    return row


@router.put("/{rule_id}", response_model=schemas.ValidationRuleRead)
def update_validation_rule(
    project_id: uuid.UUID,
    rule_id: uuid.UUID,
    payload: schemas.ValidationRuleUpdate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> models.ValidationRule:
    row = _row_or_404(db, project_id, rule_id)
    for field, value in payload.model_dump().items():
        setattr(row, field, value)
    _audit(db, context, row, "updated")
    _commit(db)
    db.refresh(row)
    return row


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_validation_rule(
    project_id: uuid.UUID,
    rule_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> None:
    row = _row_or_404(db, project_id, rule_id)
    _audit(db, context, row, "deleted")
    db.delete(row)
    db.commit()
