from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.project_access import ProjectContext, get_project_context, require_project_mutation
from ..services.layer_master_sync import ensure_project_layer_sync

router = APIRouter(prefix="/api/projects/{project_id}/align-trees", tags=["align trees"])


def _tree_or_404(db: Session, project_id: uuid.UUID, align_tree_id: uuid.UUID) -> models.AlignTree:
    tree = db.get(models.AlignTree, align_tree_id)
    if tree is None or tree.project_id != project_id or tree.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Align Tree not found")
    return tree


@router.get("", response_model=list[schemas.AlignTreeRead])
def list_align_trees(
    project_id: uuid.UUID,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> list[models.AlignTree]:
    return (
        db.query(models.AlignTree)
        .filter(models.AlignTree.project_id == project_id, models.AlignTree.deleted_at.is_(None))
        .order_by(models.AlignTree.is_default.desc(), models.AlignTree.updated_at.desc())
        .all()
    )


@router.post("", response_model=schemas.AlignTreeRead, status_code=status.HTTP_201_CREATED)
def create_align_tree(
    project_id: uuid.UUID,
    payload: schemas.AlignTreeCreate,
    context: ProjectContext = Depends(require_project_mutation),
    db: Session = Depends(get_db),
) -> models.AlignTree:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Align Tree name is required")
    has_tree = (
        db.query(models.AlignTree.id)
        .filter(models.AlignTree.project_id == project_id, models.AlignTree.deleted_at.is_(None))
        .first()
        is not None
    )
    tree = models.AlignTree(
        project_id=project_id,
        name=name,
        description=payload.description,
        created_by_actor_id=context.actor.id,
        is_default=not has_tree,
    )
    db.add(tree)
    try:
        db.flush()
        ensure_project_layer_sync(db, project_id)
        record_project_event(
            db,
            project_id=project_id,
            align_tree_id=tree.id,
            actor=context.actor,
            event_type="align_tree.created",
            target_type="align_tree",
            target_id=tree.id,
            summary=f"Created Align Tree {tree.name}",
            details={"name": tree.name},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Align Tree name already exists") from exc
    db.refresh(tree)
    return tree


@router.get("/{align_tree_id}", response_model=schemas.AlignTreeRead)
def read_align_tree(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> models.AlignTree:
    return _tree_or_404(db, project_id, align_tree_id)


@router.patch("/{align_tree_id}", response_model=schemas.AlignTreeRead)
def update_align_tree(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.AlignTreeUpdate,
    context: ProjectContext = Depends(require_project_mutation),
    db: Session = Depends(get_db),
) -> models.AlignTree:
    tree = _tree_or_404(db, project_id, align_tree_id)
    before = {"name": tree.name, "description": tree.description}
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name" and value is not None:
            value = value.strip()
            if not value:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Align Tree name is required")
        setattr(tree, field, value)
    tree.revision += 1
    try:
        record_project_event(
            db,
            project_id=project_id,
            align_tree_id=tree.id,
            actor=context.actor,
            event_type="align_tree.updated",
            target_type="align_tree",
            target_id=tree.id,
            summary=f"Updated Align Tree {tree.name}",
            details={"before": before, "after": payload.model_dump(exclude_unset=True)},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Align Tree name already exists") from exc
    db.refresh(tree)
    return tree


@router.delete("/{align_tree_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_align_tree(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    context: ProjectContext = Depends(require_project_mutation),
    db: Session = Depends(get_db),
) -> None:
    tree = _tree_or_404(db, project_id, align_tree_id)
    active_trees = (
        db.query(models.AlignTree)
        .filter(models.AlignTree.project_id == project_id, models.AlignTree.deleted_at.is_(None))
        .order_by(models.AlignTree.created_at, models.AlignTree.id)
        .all()
    )
    if len(active_trees) <= 1:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A project must keep at least one Align Tree")
    tree.deleted_at = datetime.now(timezone.utc)
    tree.revision += 1
    if tree.is_default:
        replacement = next(row for row in active_trees if row.id != tree.id)
        replacement.is_default = True
        tree.is_default = False
    record_project_event(
        db,
        project_id=project_id,
        align_tree_id=tree.id,
        actor=context.actor,
        event_type="align_tree.deleted",
        target_type="align_tree",
        target_id=tree.id,
        summary=f"Deleted Align Tree {tree.name}",
    )
    db.commit()
