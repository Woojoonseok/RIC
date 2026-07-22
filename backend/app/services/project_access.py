from __future__ import annotations

import hmac
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from fastapi import Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from .identity import get_current_actor, hash_token

AccessRole = Literal["owner", "admin", "editor", "viewer"]
ROLE_RANK: dict[AccessRole, int] = {"viewer": 1, "editor": 2, "admin": 3, "owner": 4}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def lease_is_active(lease: models.ProjectEditLease | None) -> bool:
    return lease is not None and as_utc(lease.expires_at) > utcnow()


@dataclass
class ProjectContext:
    project: models.Project
    actor: models.Actor
    role: AccessRole


def access_role_for(db: Session, project: models.Project, actor_id: uuid.UUID) -> AccessRole | None:
    membership = (
        db.query(models.ProjectMember)
        .filter(models.ProjectMember.project_id == project.id, models.ProjectMember.actor_id == actor_id)
        .one_or_none()
    )
    if membership and membership.role in ROLE_RANK:
        return membership.role  # type: ignore[return-value]
    if project.owner_actor_id == actor_id:
        return "owner"
    return None


def require_access(
    db: Session,
    project_id: uuid.UUID,
    actor: models.Actor,
    minimum: AccessRole = "viewer",
) -> ProjectContext:
    project = db.get(models.Project, project_id)
    role = access_role_for(db, project, actor.id) if project else None
    # Hide project existence from actors without access.
    if project is None or project.deleted_at is not None or role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if ROLE_RANK[role] < ROLE_RANK[minimum]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient project permission")
    return ProjectContext(project=project, actor=actor, role=role)


def get_project_context(
    project_id: uuid.UUID,
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> ProjectContext:
    return require_access(db, project_id, actor)


def get_project_editor_context(
    project_id: uuid.UUID,
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> ProjectContext:
    return require_access(db, project_id, actor, "editor")


def get_project_owner_context(
    project_id: uuid.UUID,
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> ProjectContext:
    return require_access(db, project_id, actor, "owner")


def get_project_admin_context(
    project_id: uuid.UUID,
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> ProjectContext:
    return require_access(db, project_id, actor, "admin")


def _parse_if_match(value: str | None) -> int:
    if value is None:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail="If-Match project revision is required",
        )
    match = re.fullmatch(r'(?:W/)?"?(\d+)"?', value.strip())
    if not match:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid If-Match revision")
    return int(match.group(1))


def _require_live_lease(
    db: Session,
    context: ProjectContext,
    lease_token: str | None,
) -> models.ProjectEditLease:
    if not lease_token:
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="An edit lease is required")
    lease = (
        db.query(models.ProjectEditLease)
        .filter(models.ProjectEditLease.project_id == context.project.id)
        .one_or_none()
    )
    if not lease_is_active(lease):
        if lease is not None:
            db.delete(lease)
            db.commit()
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="The edit lease has expired")
    if lease.actor_id != context.actor.id or not hmac.compare_digest(lease.token_hash, hash_token(lease_token)):
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Project is being edited by another session")
    return lease


def _advance_revision(db: Session, context: ProjectContext, expected_revision: int) -> int:
    updated = (
        db.query(models.Project)
        .filter(models.Project.id == context.project.id, models.Project.revision == expected_revision)
        .update(
            {
                models.Project.revision: models.Project.revision + 1,
                models.Project.updated_at: func.now(),
            },
            synchronize_session=False,
        )
    )
    if updated != 1:
        db.expire(context.project)
        current_revision = context.project.revision
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "Project revision is stale", "current_revision": current_revision},
        )
    db.expire(context.project)
    db.refresh(context.project)
    return context.project.revision


def require_project_mutation(
    response: Response,
    context: ProjectContext = Depends(get_project_editor_context),
    db: Session = Depends(get_db),
    x_edit_lease: str | None = Header(default=None, alias="X-Edit-Lease"),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> ProjectContext:
    _require_live_lease(db, context, x_edit_lease)
    expected_revision = _parse_if_match(if_match)
    _advance_revision(db, context, expected_revision)
    response.headers["X-Project-Revision"] = str(context.project.revision)
    response.headers["ETag"] = f'"{context.project.revision}"'
    return context


def require_project_admin_mutation(
    response: Response,
    context: ProjectContext = Depends(get_project_admin_context),
    db: Session = Depends(get_db),
    x_edit_lease: str | None = Header(default=None, alias="X-Edit-Lease"),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> ProjectContext:
    _require_live_lease(db, context, x_edit_lease)
    expected_revision = _parse_if_match(if_match)
    _advance_revision(db, context, expected_revision)
    response.headers["X-Project-Revision"] = str(context.project.revision)
    response.headers["ETag"] = f'"{context.project.revision}"'
    return context


def project_request_guard(
    request: Request,
    response: Response,
    project_id: uuid.UUID,
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
    x_edit_lease: str | None = Header(default=None, alias="X-Edit-Lease"),
    if_match: str | None = Header(default=None, alias="If-Match"),
) -> ProjectContext:
    context = require_access(db, project_id, actor, "viewer")
    if request.method.upper() not in {"GET", "HEAD", "OPTIONS"}:
        if ROLE_RANK[context.role] < ROLE_RANK["editor"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Project is read-only")
        _require_live_lease(db, context, x_edit_lease)
        expected_revision = _parse_if_match(if_match)
        _advance_revision(db, context, expected_revision)
    response.headers["X-Project-Revision"] = str(context.project.revision)
    response.headers["ETag"] = f'"{context.project.revision}"'
    return context


def project_to_read(db: Session, project: models.Project, actor: models.Actor) -> schemas.ProjectRead:
    role = access_role_for(db, project, actor.id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    lease = (
        db.query(models.ProjectEditLease)
        .filter(models.ProjectEditLease.project_id == project.id)
        .one_or_none()
    )
    active = lease_is_active(lease)
    return schemas.ProjectRead(
        id=project.id,
        name=project.name,
        description=project.description,
        created_at=project.created_at,
        updated_at=project.updated_at,
        revision=project.revision,
        access_role=role,
        is_locked=active,
        locked_by_me=bool(active and lease and lease.actor_id == actor.id),
        lock_expires_at=lease.expires_at if active and lease else None,
        lock_holder_display_name=lease.actor.display_name if active and lease else None,
    )
