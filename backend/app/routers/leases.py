from __future__ import annotations

import hmac
import secrets
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db, settings
from ..services.audit import record_project_event
from ..services.identity import hash_token
from ..services.project_access import (
    ProjectContext,
    get_project_editor_context,
    lease_is_active,
    utcnow,
)

router = APIRouter(prefix="/api/projects/{project_id}/lease", tags=["editing"])


def _new_expiry():
    return utcnow() + timedelta(seconds=max(30, settings.edit_lease_ttl_seconds))


def _lease_for_project(db: Session, project_id: uuid.UUID) -> models.ProjectEditLease | None:
    return (
        db.query(models.ProjectEditLease)
        .filter(models.ProjectEditLease.project_id == project_id)
        .one_or_none()
    )


def _locked_detail(lease: models.ProjectEditLease) -> dict[str, str]:
    return {
        "message": "Project is being edited by another session",
        "holder_display_name": lease.actor.display_name,
        "expires_at": lease.expires_at.isoformat(),
    }


def _valid_owned_lease(
    db: Session,
    context: ProjectContext,
    token: str | None,
    client_instance_id: str | None = None,
) -> models.ProjectEditLease:
    lease = _lease_for_project(db, context.project.id)
    if (
        not token
        or not lease_is_active(lease)
        or lease is None
        or lease.actor_id != context.actor.id
        or not hmac.compare_digest(lease.token_hash, hash_token(token))
        or (client_instance_id is not None and lease.client_instance_id != client_instance_id)
    ):
        if lease_is_active(lease) and lease is not None:
            raise HTTPException(status_code=status.HTTP_423_LOCKED, detail=_locked_detail(lease))
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="The edit lease is not valid for this session")
    return lease


@router.post("", response_model=schemas.LeaseRead)
def acquire_lease(
    project_id: uuid.UUID,
    payload: schemas.LeaseAcquire,
    context: ProjectContext = Depends(get_project_editor_context),
    db: Session = Depends(get_db),
) -> schemas.LeaseRead:
    lease = _lease_for_project(db, context.project.id)
    active = lease_is_active(lease)
    same_session = bool(
        active
        and lease
        and lease.actor_id == context.actor.id
        and lease.client_instance_id == payload.client_instance_id
    )
    forced_takeover = bool(active and lease and not same_session and payload.force and context.role == "owner")
    previous_actor_id = lease.actor_id if forced_takeover and lease else None
    if active and not same_session:
        if not payload.force or context.role != "owner":
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=_locked_detail(lease),
            )
    if lease is not None and (not active or same_session or payload.force):
        db.delete(lease)
        db.flush()

    token = secrets.token_urlsafe(32)
    now = utcnow()
    lease = models.ProjectEditLease(
        project_id=context.project.id,
        actor_id=context.actor.id,
        client_instance_id=payload.client_instance_id,
        token_hash=hash_token(token),
        heartbeat_at=now,
        expires_at=_new_expiry(),
    )
    db.add(lease)
    try:
        db.flush()
        record_project_event(
            db,
            project_id=context.project.id,
            actor=context.actor,
            event_type="lease.force_taken_over" if forced_takeover else "lease.acquired",
            target_type="project_edit_lease",
            target_id=lease.id,
            summary=(
                f"Force-took over the edit lease for {context.project.name}"
                if forced_takeover
                else f"Acquired the edit lease for {context.project.name}"
            ),
            details={
                "previous_actor_id": str(previous_actor_id) if previous_actor_id else None,
                "same_session_reacquire": same_session,
            },
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_423_LOCKED, detail="Project is being edited by another session") from exc
    return schemas.LeaseRead(lease_token=token, expires_at=lease.expires_at, revision=context.project.revision)


@router.put("", response_model=schemas.LeaseRead)
def heartbeat_lease(
    project_id: uuid.UUID,
    payload: schemas.LeaseHeartbeat,
    context: ProjectContext = Depends(get_project_editor_context),
    db: Session = Depends(get_db),
    x_edit_lease: str | None = Header(default=None, alias="X-Edit-Lease"),
) -> schemas.LeaseRead:
    lease = _valid_owned_lease(db, context, x_edit_lease, payload.client_instance_id)
    lease.heartbeat_at = utcnow()
    lease.expires_at = _new_expiry()
    db.commit()
    return schemas.LeaseRead(
        lease_token=x_edit_lease or "",
        expires_at=lease.expires_at,
        revision=context.project.revision,
    )


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def release_lease(
    project_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_editor_context),
    db: Session = Depends(get_db),
    x_edit_lease: str | None = Header(default=None, alias="X-Edit-Lease"),
) -> Response:
    lease = _valid_owned_lease(db, context, x_edit_lease)
    lease_id = lease.id
    db.delete(lease)
    record_project_event(
        db,
        project_id=context.project.id,
        actor=context.actor,
        event_type="lease.released",
        target_type="project_edit_lease",
        target_id=lease_id,
        summary=f"Released the edit lease for {context.project.name}",
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
