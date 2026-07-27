from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.identity import get_current_actor
from ..services.project_access import (
    ProjectContext,
    access_role_for,
    get_project_admin_context,
    get_project_context,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["project governance"])


def _actor_summary(actor: models.Actor | None) -> schemas.ActorSummary | None:
    return schemas.ActorSummary(id=actor.id, display_name=actor.display_name) if actor else None


def _member_read(member: models.ProjectMember) -> schemas.ProjectMemberRead:
    return schemas.ProjectMemberRead(
        id=member.id,
        project_id=member.project_id,
        actor=_actor_summary(member.actor),  # type: ignore[arg-type]
        role=member.role,  # type: ignore[arg-type]
        added_by_actor_id=member.added_by_actor_id,
        created_at=member.created_at,
    )


def _request_read(row: models.ProjectAccessRequest) -> schemas.AccessRequestRead:
    return schemas.AccessRequestRead(
        id=row.id,
        project_id=row.project_id,
        requester=_actor_summary(row.requester),  # type: ignore[arg-type]
        requested_role=row.requested_role,  # type: ignore[arg-type]
        message=row.message,
        status=row.status,  # type: ignore[arg-type]
        reviewed_by=_actor_summary(row.reviewed_by),
        reviewed_at=row.reviewed_at,
        decision_note=row.decision_note,
        created_at=row.created_at,
    )


@router.post("/access-requests", response_model=schemas.AccessRequestRead, status_code=status.HTTP_201_CREATED)
def request_project_access(
    project_id: uuid.UUID,
    payload: schemas.AccessRequestCreate,
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> schemas.AccessRequestRead:
    project = crud.get_project_or_404(db, project_id)
    if project.deleted_at is not None or not project.is_public:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if access_role_for(db, project, actor.id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already a project member")
    pending = (
        db.query(models.ProjectAccessRequest)
        .filter(
            models.ProjectAccessRequest.project_id == project_id,
            models.ProjectAccessRequest.requester_actor_id == actor.id,
            models.ProjectAccessRequest.status == "pending",
        )
        .first()
    )
    if pending is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An access request is already pending")
    row = models.ProjectAccessRequest(
        project_id=project_id,
        requester_actor_id=actor.id,
        requested_role=payload.requested_role,
        message=payload.message,
        status="pending",
    )
    db.add(row)
    db.flush()
    record_project_event(
        db,
        project_id=project_id,
        actor=actor,
        event_type="access.requested",
        target_type="access_request",
        target_id=row.id,
        summary=f"{actor.display_name} requested {payload.requested_role} access",
        details={"requested_role": payload.requested_role},
    )
    db.commit()
    db.refresh(row)
    return _request_read(row)


@router.get("/access-requests", response_model=list[schemas.AccessRequestRead])
def list_access_requests(
    project_id: uuid.UUID,
    request_status: str | None = Query(default=None, alias="status"),
    _context: ProjectContext = Depends(get_project_admin_context),
    db: Session = Depends(get_db),
) -> list[schemas.AccessRequestRead]:
    query = db.query(models.ProjectAccessRequest).filter(models.ProjectAccessRequest.project_id == project_id)
    if request_status:
        query = query.filter(models.ProjectAccessRequest.status == request_status)
    rows = query.order_by(models.ProjectAccessRequest.created_at.desc()).all()
    return [_request_read(row) for row in rows]


@router.patch("/access-requests/{request_id}", response_model=schemas.AccessRequestRead)
def decide_access_request(
    project_id: uuid.UUID,
    request_id: uuid.UUID,
    payload: schemas.AccessRequestDecision,
    context: ProjectContext = Depends(get_project_admin_context),
    db: Session = Depends(get_db),
) -> schemas.AccessRequestRead:
    row = db.get(models.ProjectAccessRequest, request_id)
    if row is None or row.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Access request not found")
    if row.status != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Access request was already reviewed")
    assigned_role = payload.role or row.requested_role
    if payload.status == "approved" and assigned_role == "admin" and context.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can grant admin role")

    row.status = payload.status
    row.reviewed_by_actor_id = context.actor.id
    row.reviewed_at = datetime.now(timezone.utc)
    row.decision_note = payload.decision_note
    if payload.status == "approved":
        member = (
            db.query(models.ProjectMember)
            .filter(
                models.ProjectMember.project_id == project_id,
                models.ProjectMember.actor_id == row.requester_actor_id,
            )
            .one_or_none()
        )
        if member is None:
            db.add(
                models.ProjectMember(
                    project_id=project_id,
                    actor_id=row.requester_actor_id,
                    role=assigned_role,
                    added_by_actor_id=context.actor.id,
                )
            )
        else:
            member.role = assigned_role
    record_project_event(
        db,
        project_id=project_id,
        actor=context.actor,
        event_type=f"access.{payload.status}",
        target_type="access_request",
        target_id=row.id,
        summary=f"{payload.status.title()} access request from {row.requester.display_name}",
        details={"assigned_role": assigned_role if payload.status == "approved" else None},
    )
    db.commit()
    db.refresh(row)
    return _request_read(row)


@router.get("/members", response_model=list[schemas.ProjectMemberRead])
def list_members(
    project_id: uuid.UUID,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> list[schemas.ProjectMemberRead]:
    rows = (
        db.query(models.ProjectMember)
        .filter(models.ProjectMember.project_id == project_id)
        .order_by(models.ProjectMember.created_at, models.ProjectMember.id)
        .all()
    )
    return [_member_read(row) for row in rows]


@router.post("/members", response_model=schemas.ProjectMemberRead, status_code=status.HTTP_201_CREATED)
def add_member(
    project_id: uuid.UUID,
    payload: schemas.ProjectMemberCreate,
    context: ProjectContext = Depends(get_project_admin_context),
    db: Session = Depends(get_db),
) -> schemas.ProjectMemberRead:
    if payload.role == "admin" and context.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can add admins")
    target = db.get(models.Actor, payload.actor_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    existing = (
        db.query(models.ProjectMember)
        .filter(models.ProjectMember.project_id == project_id, models.ProjectMember.actor_id == target.id)
        .one_or_none()
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User is already a member")
    member = models.ProjectMember(
        project_id=project_id,
        actor_id=target.id,
        role=payload.role,
        added_by_actor_id=context.actor.id,
    )
    db.add(member)
    db.flush()
    record_project_event(
        db,
        project_id=project_id,
        actor=context.actor,
        event_type="member.added",
        target_type="member",
        target_id=member.id,
        summary=f"Added {target.display_name} as {payload.role}",
        details={"values": {"name": target.display_name, "role": payload.role}},
    )
    db.commit()
    db.refresh(member)
    return _member_read(member)


@router.patch("/members/{actor_id}", response_model=schemas.ProjectMemberRead)
def update_member(
    project_id: uuid.UUID,
    actor_id: uuid.UUID,
    payload: schemas.ProjectMemberUpdate,
    context: ProjectContext = Depends(get_project_admin_context),
    db: Session = Depends(get_db),
) -> schemas.ProjectMemberRead:
    member = (
        db.query(models.ProjectMember)
        .filter(models.ProjectMember.project_id == project_id, models.ProjectMember.actor_id == actor_id)
        .one_or_none()
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project member not found")
    if member.role == "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner role cannot be changed here")
    if (member.role == "admin" or payload.role == "admin") and context.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can manage admins")
    previous_role = member.role
    member.role = payload.role
    record_project_event(
        db,
        project_id=project_id,
        actor=context.actor,
        event_type="member.role_changed",
        target_type="member",
        target_id=member.id,
        summary=f"Changed {member.actor.display_name} from {previous_role} to {payload.role}",
        details={
            "actor_id": str(actor_id),
            "before": {"role": previous_role},
            "after": {"role": payload.role},
        },
    )
    db.commit()
    db.refresh(member)
    return _member_read(member)


@router.delete("/members/{actor_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    project_id: uuid.UUID,
    actor_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_admin_context),
    db: Session = Depends(get_db),
) -> None:
    member = (
        db.query(models.ProjectMember)
        .filter(models.ProjectMember.project_id == project_id, models.ProjectMember.actor_id == actor_id)
        .one_or_none()
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project member not found")
    if member.role == "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner cannot be removed")
    if member.role == "admin" and context.role != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner can remove admins")
    target_label = member.actor.display_name
    member_id = member.id
    purged_legacy_grants = (
        db.query(models.ProjectAccess)
        .filter(
            models.ProjectAccess.project_id == project_id,
            models.ProjectAccess.actor_id == actor_id,
        )
        .delete(synchronize_session=False)
    )
    db.delete(member)
    record_project_event(
        db,
        project_id=project_id,
        actor=context.actor,
        event_type="member.removed",
        target_type="member",
        target_id=member_id,
        summary=f"Removed {target_label} from the project",
        details={"values": {"name": target_label, "role": member.role}},
    )
    db.commit()


@router.get("/audit-events", response_model=list[schemas.AuditEventRead])
def list_audit_events(
    project_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=100),
    before: datetime | None = Query(default=None),
    changes_only: bool = Query(default=False),
    align_tree_id: uuid.UUID | None = Query(default=None),
    target_id: uuid.UUID | None = Query(default=None),
    event_prefix: list[str] | None = Query(default=None),
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> list[schemas.AuditEventRead]:
    query = db.query(models.ProjectAuditEvent).filter(models.ProjectAuditEvent.project_id == project_id)
    if before is not None:
        query = query.filter(models.ProjectAuditEvent.created_at < before)
    if changes_only:
        query = query.filter(
            ~models.ProjectAuditEvent.event_type.like("lease.%"),
            ~models.ProjectAuditEvent.event_type.like("project.migrated%"),
        )
    if align_tree_id is not None:
        query = query.filter(models.ProjectAuditEvent.align_tree_id == align_tree_id)
    if target_id is not None:
        query = query.filter(models.ProjectAuditEvent.target_id == target_id)
    prefixes = [prefix.strip() for prefix in (event_prefix or []) if prefix.strip()]
    if prefixes:
        query = query.filter(or_(*(models.ProjectAuditEvent.event_type.like(f"{prefix}%") for prefix in prefixes)))
    rows = query.order_by(models.ProjectAuditEvent.created_at.desc(), models.ProjectAuditEvent.id.desc()).limit(limit).all()
    return [
        schemas.AuditEventRead(
            id=row.id,
            project_id=row.project_id,
            align_tree_id=row.align_tree_id,
            actor=_actor_summary(row.actor),
            actor_label_snapshot=row.actor_label_snapshot,
            event_type=row.event_type,
            target_type=row.target_type,
            target_id=row.target_id,
            summary=row.summary,
            details_json=row.details_json or {},
            created_at=row.created_at,
        )
        for row in rows
    ]
