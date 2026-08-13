from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.identity import require_system_admin
from ..services.project_catalog import project_public_read

router = APIRouter(prefix="/api/system-admin", tags=["system administration"])


def _project_or_404(db: Session, project_id: uuid.UUID, *, include_deleted: bool = False) -> models.Project:
    project = db.get(models.Project, project_id)
    if project is None or (project.deleted_at is not None and not include_deleted):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _admin_read(db: Session, project: models.Project, actor: models.Actor) -> schemas.SystemAdminProjectRead:
    payload = project_public_read(db, project, actor).model_dump()
    owner = project.owner
    return schemas.SystemAdminProjectRead(
        **payload,
        owner=schemas.ActorSummary(id=owner.id, display_name=owner.display_name) if owner else None,
        deleted_at=project.deleted_at,
    )


@router.get("/projects", response_model=list[schemas.SystemAdminProjectRead])
def list_all_projects(
    include_deleted: bool = Query(default=False),
    actor: models.Actor = Depends(require_system_admin),
    db: Session = Depends(get_db),
) -> list[schemas.SystemAdminProjectRead]:
    query = db.query(models.Project)
    if not include_deleted:
        query = query.filter(models.Project.deleted_at.is_(None))
    projects = query.order_by(models.Project.updated_at.desc(), models.Project.created_at.desc()).all()
    return [_admin_read(db, project, actor) for project in projects]


@router.patch("/projects/{project_id}", response_model=schemas.SystemAdminProjectRead)
def update_any_project(
    project_id: uuid.UUID,
    payload: schemas.SystemAdminProjectUpdate,
    actor: models.Actor = Depends(require_system_admin),
    db: Session = Depends(get_db),
) -> schemas.SystemAdminProjectRead:
    project = _project_or_404(db, project_id)
    before = {"name": project.name, "description": project.description, "is_public": project.is_public}
    values = payload.model_dump(exclude_unset=True)
    if values.get("is_public") is None and "is_public" in values:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Public state must be true or false")
    if "name" in values:
        values["name"] = (values["name"] or "").strip()
        if not values["name"]:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Project name is required")
    for field, value in values.items():
        setattr(project, field, value)
    project.revision += 1
    record_project_event(
        db,
        project_id=project.id,
        actor=actor,
        event_type="system_admin.project_updated",
        target_type="project",
        target_id=project.id,
        summary=f"System administrator updated project {project.name}",
        details={
            "before": before,
            "after": {"name": project.name, "description": project.description, "is_public": project.is_public},
        },
    )
    db.commit()
    db.refresh(project)
    return _admin_read(db, project, actor)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_any_project(
    project_id: uuid.UUID,
    actor: models.Actor = Depends(require_system_admin),
    db: Session = Depends(get_db),
) -> None:
    project = _project_or_404(db, project_id)
    record_project_event(
        db,
        project_id=project.id,
        actor=actor,
        event_type="system_admin.project_deleted",
        target_type="project",
        target_id=project.id,
        summary=f"System administrator deleted project {project.name}",
        details={"values": {"name": project.name, "is_public": project.is_public}},
    )
    if project.edit_lease is not None:
        db.delete(project.edit_lease)
    project.deleted_at = datetime.now(timezone.utc)
    project.revision += 1
    db.commit()
