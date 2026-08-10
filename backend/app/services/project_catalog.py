from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from .. import models, schemas
from .project_access import access_role_for, lease_is_active


def default_align_tree(db: Session, project_id: uuid.UUID) -> models.AlignTree | None:
    return (
        db.query(models.AlignTree)
        .filter(models.AlignTree.project_id == project_id, models.AlignTree.deleted_at.is_(None))
        .order_by(models.AlignTree.is_default.desc(), models.AlignTree.created_at, models.AlignTree.id)
        .first()
    )


def project_public_read(db: Session, project: models.Project, actor: models.Actor) -> schemas.ProjectPublicRead:
    role = access_role_for(db, project, actor.id)
    latest_request = (
        db.query(models.ProjectAccessRequest)
        .filter(
            models.ProjectAccessRequest.project_id == project.id,
            models.ProjectAccessRequest.requester_actor_id == actor.id,
        )
        .order_by(models.ProjectAccessRequest.created_at.desc())
        .first()
    )
    lease = (
        db.query(models.ProjectEditLease)
        .filter(models.ProjectEditLease.project_id == project.id)
        .one_or_none()
    )
    active_lease = lease_is_active(lease)
    creator = project.creator
    return schemas.ProjectPublicRead(
        id=project.id,
        name=project.name,
        description=project.description,
        created_at=project.created_at,
        updated_at=project.updated_at,
        revision=project.revision,
        access_role=role,
        is_locked=active_lease,
        locked_by_me=bool(active_lease and lease and lease.actor_id == actor.id),
        lock_expires_at=lease.expires_at if active_lease and lease else None,
        lock_holder_actor_id=(lease.actor_id if active_lease and lease and role is not None else None),
        lock_holder_display_name=(
            lease.actor.display_name if active_lease and lease and role is not None else None
        ),
        creator=schemas.ActorSummary(id=creator.id, display_name=creator.display_name) if creator else None,
        creator_display_name=project.creator_display_name,
        my_role=role,
        access_request_status=latest_request.status if latest_request else None,  # type: ignore[arg-type]
        align_tree_count=(
            db.query(models.AlignTree)
            .filter(models.AlignTree.project_id == project.id, models.AlignTree.deleted_at.is_(None))
            .count()
        ),
        member_count=db.query(models.ProjectMember).filter(models.ProjectMember.project_id == project.id).count(),
        is_public=project.is_public,
        is_legacy_unclaimed=project.is_legacy_unclaimed,
    )
