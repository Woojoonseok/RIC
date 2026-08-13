from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db, settings
from ..services.audit import record_project_event
from ..services.identity import get_current_actor, is_system_admin
from ..services.project_access import (
    ProjectContext,
    get_project_context,
    require_project_admin_mutation,
    require_project_mutation,
)
from ..services.project_catalog import project_public_read
from ..services.project_reference import clone_project_reference_data, ensure_project_reference_data

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _visible_project_or_404(db: Session, project_id: uuid.UUID, actor: models.Actor) -> models.Project:
    project = db.get(models.Project, project_id)
    has_access = project is not None and (
        project.is_public
        or is_system_admin(actor)
        or project.owner_actor_id == actor.id
        or db.query(models.ProjectMember.id).filter(
            models.ProjectMember.project_id == project_id,
            models.ProjectMember.actor_id == actor.id,
        ).first() is not None
    )
    if project is None or project.deleted_at is not None or not has_access:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("", response_model=list[schemas.ProjectPublicRead])
def list_projects(
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> list[schemas.ProjectPublicRead]:
    query = db.query(models.Project).filter(models.Project.deleted_at.is_(None))
    if not is_system_admin(actor):
        member_project_ids = db.query(models.ProjectMember.project_id).filter(models.ProjectMember.actor_id == actor.id)
        query = query.filter(or_(
            models.Project.is_public.is_(True),
            models.Project.owner_actor_id == actor.id,
            models.Project.id.in_(member_project_ids),
        ))
    projects = (
        query
        .order_by(models.Project.updated_at.desc(), models.Project.created_at.desc())
        .all()
    )
    return [project_public_read(db, project, actor) for project in projects]


@router.post("", response_model=schemas.ProjectPublicRead, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: schemas.ProjectCreate,
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> schemas.ProjectPublicRead:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Project name is required")
    project = models.Project(
        name=name,
        description=payload.description,
        owner_actor_id=actor.id,
        created_by_actor_id=actor.id,
        creator_display_name=actor.display_name,
        is_public=True,
        is_legacy_unclaimed=False,
    )
    db.add(project)
    db.flush()
    db.add(models.ProjectMember(project_id=project.id, actor_id=actor.id, role="owner", added_by_actor_id=actor.id))
    tree = models.AlignTree(
        project_id=project.id,
        name="Main",
        description="Default Align Tree",
        created_by_actor_id=actor.id,
        is_default=True,
    )
    db.add(tree)
    ensure_project_reference_data(db, project.id)
    record_project_event(
        db,
        project_id=project.id,
        actor=actor,
        event_type="project.created",
        target_type="project",
        target_id=project.id,
        summary=f"Created project {project.name}",
        details={"values": {"name": project.name, "description": project.description}},
    )
    db.commit()
    db.refresh(project)
    return project_public_read(db, project, actor)


@router.post(
    "/{project_id}/branch",
    response_model=schemas.ProjectPublicRead,
    status_code=status.HTTP_201_CREATED,
)
def branch_project(
    project_id: uuid.UUID,
    payload: schemas.ProjectBranchCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.ProjectPublicRead:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Project name is required")
    project = models.Project(
        name=name,
        description=payload.description,
        owner_actor_id=context.actor.id,
        created_by_actor_id=context.actor.id,
        creator_display_name=context.actor.display_name,
        is_public=True,
        is_legacy_unclaimed=False,
    )
    db.add(project)
    db.flush()
    db.add(
        models.ProjectMember(
            project_id=project.id,
            actor_id=context.actor.id,
            role="owner",
            added_by_actor_id=context.actor.id,
        )
    )
    tree = models.AlignTree(
        project_id=project.id,
        name="Main",
        description="Project Editor",
        created_by_actor_id=context.actor.id,
        is_default=True,
    )
    db.add(tree)
    clone_project_reference_data(db, project_id, project.id)
    record_project_event(
        db,
        project_id=project.id,
        actor=context.actor,
        event_type="project.branched",
        target_type="project",
        target_id=project.id,
        summary=f"Created project {project.name} from {context.project.name}",
        details={
            "source_project_id": str(context.project.id),
            "source_project_name": context.project.name,
            "copied": ["reference", "layer_master"],
        },
    )
    db.commit()
    db.refresh(project)
    return project_public_read(db, project, context.actor)


@router.post("/{project_id}/claim-legacy", response_model=schemas.ProjectPublicRead)
def claim_legacy_project(
    project_id: uuid.UUID,
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> schemas.ProjectPublicRead:
    if not settings.allow_legacy_project_claims:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="기존 프로젝트 가져오기가 비활성화되어 있습니다. 서버의 ALLOW_LEGACY_PROJECT_CLAIMS 설정을 확인하세요.",
        )
    updated = (
        db.query(models.Project)
        .filter(
            models.Project.id == project_id,
            models.Project.deleted_at.is_(None),
            models.Project.is_legacy_unclaimed.is_(True),
            models.Project.owner_actor_id.is_(None),
        )
        .update(
            {
                models.Project.owner_actor_id: actor.id,
                models.Project.created_by_actor_id: actor.id,
                models.Project.creator_display_name: actor.display_name,
                models.Project.is_legacy_unclaimed: False,
            },
            synchronize_session=False,
        )
    )
    if updated != 1:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 가져온 프로젝트이거나 소유권 정보가 올바르지 않습니다.",
        )
    project = db.get(models.Project, project_id)
    assert project is not None
    member = (
        db.query(models.ProjectMember)
        .filter(models.ProjectMember.project_id == project.id, models.ProjectMember.actor_id == actor.id)
        .one_or_none()
    )
    if member is None:
        db.add(models.ProjectMember(project_id=project.id, actor_id=actor.id, role="owner", added_by_actor_id=actor.id))
    else:
        member.role = "owner"
        member.added_by_actor_id = actor.id
    db.query(models.ProjectAccessRequest).filter(
        models.ProjectAccessRequest.project_id == project.id,
        models.ProjectAccessRequest.requester_actor_id == actor.id,
        models.ProjectAccessRequest.status == "pending",
    ).update({models.ProjectAccessRequest.status: "cancelled"}, synchronize_session=False)
    record_project_event(
        db,
        project_id=project.id,
        actor=actor,
        event_type="project.legacy_claimed",
        target_type="project",
        target_id=project.id,
        summary=f"Claimed legacy project {project.name}",
    )
    db.commit()
    db.refresh(project)
    return project_public_read(db, project, actor)


@router.get("/{project_id}", response_model=schemas.ProjectPublicRead)
def read_project(
    project_id: uuid.UUID,
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> schemas.ProjectPublicRead:
    return project_public_read(db, _visible_project_or_404(db, project_id, actor), actor)


@router.patch("/{project_id}", response_model=schemas.ProjectPublicRead)
def update_project(
    project_id: uuid.UUID,
    payload: schemas.ProjectUpdate,
    context: ProjectContext = Depends(require_project_admin_mutation),
    db: Session = Depends(get_db),
) -> schemas.ProjectPublicRead:
    before = {"name": context.project.name, "description": context.project.description}
    for field, value in payload.model_dump(exclude_unset=True).items():
        if field == "name" and value is not None:
            value = value.strip()
            if not value:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Project name is required")
        setattr(context.project, field, value)
    record_project_event(
        db,
        project_id=context.project.id,
        actor=context.actor,
        event_type="project.updated",
        target_type="project",
        target_id=context.project.id,
        summary=f"Updated project {context.project.name}",
        details={
            "before": before,
            "after": {
                "name": context.project.name,
                "description": context.project.description,
            },
        },
    )
    db.commit()
    db.refresh(context.project)
    return project_public_read(db, context.project, context.actor)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: uuid.UUID,
    context: ProjectContext = Depends(require_project_mutation),
    db: Session = Depends(get_db),
) -> None:
    if context.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can delete a project")
    snapshot = {"name": context.project.name, "description": context.project.description}
    context.project.deleted_at = datetime.now(timezone.utc)
    record_project_event(
        db,
        project_id=context.project.id,
        actor=context.actor,
        event_type="project.deleted",
        target_type="project",
        target_id=context.project.id,
        summary=f"Deleted project {context.project.name}",
        details={"values": snapshot},
    )
    db.commit()
