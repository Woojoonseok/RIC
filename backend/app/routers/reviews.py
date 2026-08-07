from __future__ import annotations

import base64
import binascii
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.project_access import ProjectContext, ROLE_RANK, access_role_for, get_project_context

router = APIRouter(prefix="/api/projects/{project_id}/review-threads", tags=["reviews"])


def _thread_query(db: Session):
    return db.query(models.ReviewThread).options(
        selectinload(models.ReviewThread.created_by),
        selectinload(models.ReviewThread.assignee),
        selectinload(models.ReviewThread.resolved_by),
        selectinload(models.ReviewThread.comments).selectinload(models.ReviewComment.author),
        selectinload(models.ReviewThread.comments).selectinload(models.ReviewComment.attachments),
    )


def _actor_read(actor: models.Actor | None) -> schemas.ActorSummary | None:
    return schemas.ActorSummary(id=actor.id, display_name=actor.display_name) if actor else None


def _thread_read(row: models.ReviewThread) -> schemas.ReviewThreadRead:
    return schemas.ReviewThreadRead(
        id=row.id,
        project_id=row.project_id,
        align_tree_id=row.align_tree_id,
        target_type=row.target_type,
        target_id=row.target_id,
        target_key=row.target_key,
        target_label=row.target_label,
        anchor_x=row.anchor_x,
        anchor_y=row.anchor_y,
        status=row.status,
        created_by=_actor_read(row.created_by),
        assignee=_actor_read(row.assignee),
        resolved_by=_actor_read(row.resolved_by),
        resolved_at=row.resolved_at,
        comments=[
            schemas.ReviewCommentRead(
                id=comment.id,
                thread_id=comment.thread_id,
                parent_comment_id=comment.parent_comment_id,
                author=_actor_read(comment.author),
                author_label=comment.author_label,
                body=comment.body,
                attachments=[
                    schemas.ReviewAttachmentRead(
                        id=attachment.id,
                        kind=attachment.kind,
                        filename=attachment.filename,
                        mime_type=attachment.mime_type,
                        size_bytes=attachment.size_bytes,
                    )
                    for attachment in comment.attachments
                ],
                created_at=comment.created_at,
                updated_at=comment.updated_at,
            )
            for comment in row.comments
        ],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _thread_or_404(db: Session, project_id: uuid.UUID, thread_id: uuid.UUID) -> models.ReviewThread:
    row = _thread_query(db).filter(
        models.ReviewThread.id == thread_id,
        models.ReviewThread.project_id == project_id,
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review thread not found")
    return row


def _tree_exists(db: Session, project_id: uuid.UUID, tree_id: uuid.UUID) -> bool:
    return db.query(models.AlignTree.id).filter(
        models.AlignTree.id == tree_id,
        models.AlignTree.project_id == project_id,
        models.AlignTree.deleted_at.is_(None),
    ).first() is not None


def _validate_target(db: Session, project_id: uuid.UUID, payload: schemas.ReviewThreadCreate) -> None:
    if not _tree_exists(db, project_id, payload.align_tree_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Align Tree not found")
    model_by_type = {
        "layer": models.Layer,
        "relation": models.LayerRelation,
        "text_box": models.TextBox,
        "snapshot": models.GraphSnapshot,
    }
    model = model_by_type.get(payload.target_type)
    if model is not None:
        target = db.get(model, payload.target_id)
        if target is None or target.project_id != project_id or target.align_tree_id != payload.align_tree_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review target not found")


def _validate_assignee(
    db: Session,
    context: ProjectContext,
    actor_id: uuid.UUID | None,
) -> models.Actor | None:
    if actor_id is None:
        return None
    actor = db.get(models.Actor, actor_id)
    if actor is None or access_role_for(db, context.project, actor.id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Assignee must be a project member")
    return actor


def _create_comment(
    db: Session,
    context: ProjectContext,
    thread: models.ReviewThread,
    body: str,
    parent_comment_id: uuid.UUID | None,
    mentioned_actor_ids: list[uuid.UUID],
    attachments: list[schemas.ReviewAttachmentCreate],
) -> models.ReviewComment:
    comment = models.ReviewComment(
        thread_id=thread.id,
        parent_comment_id=parent_comment_id,
        author_actor_id=context.actor.id,
        author_label=context.actor.display_name,
        body=body.strip(),
    )
    db.add(comment)
    db.flush()
    for attachment in attachments:
        try:
            data = base64.b64decode(attachment.data_base64, validate=True)
        except (binascii.Error, ValueError) as error:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid image attachment") from error
        if len(data) > 2 * 1024 * 1024:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Each image must be 2 MB or smaller")
        db.add(models.ReviewAttachment(
            comment_id=comment.id,
            kind=attachment.kind,
            filename=attachment.filename.strip(),
            mime_type=attachment.mime_type,
            size_bytes=len(data),
            data=data,
        ))
    for actor_id in dict.fromkeys(mentioned_actor_ids):
        if actor_id == context.actor.id:
            continue
        actor = db.get(models.Actor, actor_id)
        if actor is None or access_role_for(db, context.project, actor.id) is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Mentioned user must be a project member")
        db.add(models.ReviewNotification(
            project_id=thread.project_id,
            thread_id=thread.id,
            comment_id=comment.id,
            actor_id=actor.id,
        ))
    return comment


@router.get("", response_model=list[schemas.ReviewThreadRead])
def list_threads(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID | None = None,
    thread_status: str | None = Query(default=None, alias="status", pattern="^(open|resolved)$"),
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> list[schemas.ReviewThreadRead]:
    query = _thread_query(db).filter(models.ReviewThread.project_id == project_id)
    if align_tree_id is not None:
        query = query.filter(models.ReviewThread.align_tree_id == align_tree_id)
    if thread_status is not None:
        query = query.filter(models.ReviewThread.status == thread_status)
    rows = query.order_by(models.ReviewThread.updated_at.desc(), models.ReviewThread.id.desc()).all()
    return [_thread_read(row) for row in rows]


@router.get("/assignees", response_model=list[schemas.ActorSummary])
def list_assignees(
    project_id: uuid.UUID,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> list[schemas.ActorSummary]:
    actors = (
        db.query(models.Actor)
        .join(models.ProjectMember, models.ProjectMember.actor_id == models.Actor.id)
        .filter(models.ProjectMember.project_id == project_id)
        .order_by(models.Actor.display_name, models.Actor.id)
        .all()
    )
    if context.project.owner_actor_id and not any(actor.id == context.project.owner_actor_id for actor in actors):
        owner = db.get(models.Actor, context.project.owner_actor_id)
        if owner:
            actors.insert(0, owner)
    return [schemas.ActorSummary(id=actor.id, display_name=actor.display_name) for actor in actors]


@router.get("/notifications", response_model=list[schemas.ReviewNotificationRead])
def list_notifications(
    project_id: uuid.UUID,
    unread_only: bool = True,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> list[schemas.ReviewNotificationRead]:
    query = (
        db.query(models.ReviewNotification, models.ReviewThread, models.ReviewComment)
        .join(models.ReviewThread, models.ReviewThread.id == models.ReviewNotification.thread_id)
        .join(models.ReviewComment, models.ReviewComment.id == models.ReviewNotification.comment_id)
        .filter(
            models.ReviewNotification.project_id == project_id,
            models.ReviewNotification.actor_id == context.actor.id,
        )
    )
    if unread_only:
        query = query.filter(models.ReviewNotification.read_at.is_(None))
    return [
        schemas.ReviewNotificationRead(
            id=notification.id,
            thread_id=thread.id,
            comment_id=comment.id,
            target_label=thread.target_label,
            author_label=comment.author_label,
            body=comment.body,
            read_at=notification.read_at,
            created_at=notification.created_at,
        )
        for notification, thread, comment in query.order_by(models.ReviewNotification.created_at.desc()).all()
    ]


@router.post("/notifications/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_notifications_read(
    project_id: uuid.UUID,
    payload: schemas.ReviewNotificationReadRequest,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> Response:
    query = db.query(models.ReviewNotification).filter(
        models.ReviewNotification.project_id == project_id,
        models.ReviewNotification.actor_id == context.actor.id,
        models.ReviewNotification.read_at.is_(None),
    )
    if payload.notification_ids:
        query = query.filter(models.ReviewNotification.id.in_(payload.notification_ids))
    query.update({models.ReviewNotification.read_at: datetime.now(UTC)}, synchronize_session=False)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/attachments/{attachment_id}")
def read_attachment(
    project_id: uuid.UUID,
    attachment_id: uuid.UUID,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> Response:
    row = (
        db.query(models.ReviewAttachment)
        .join(models.ReviewComment, models.ReviewComment.id == models.ReviewAttachment.comment_id)
        .join(models.ReviewThread, models.ReviewThread.id == models.ReviewComment.thread_id)
        .filter(models.ReviewAttachment.id == attachment_id, models.ReviewThread.project_id == project_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review attachment not found")
    return Response(content=row.data, media_type=row.mime_type, headers={"Cache-Control": "private, max-age=3600"})


@router.post("", response_model=schemas.ReviewThreadRead, status_code=status.HTTP_201_CREATED)
def create_thread(
    project_id: uuid.UUID,
    payload: schemas.ReviewThreadCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.ReviewThreadRead:
    _validate_target(db, project_id, payload)
    assignee = _validate_assignee(db, context, payload.assignee_actor_id)
    row = models.ReviewThread(
        project_id=project_id,
        align_tree_id=payload.align_tree_id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        target_key=payload.target_key.strip() if payload.target_key else None,
        target_label=payload.target_label.strip(),
        anchor_x=payload.anchor_x,
        anchor_y=payload.anchor_y,
        created_by_actor_id=context.actor.id,
        assignee_actor_id=assignee.id if assignee else None,
    )
    db.add(row)
    db.flush()
    _create_comment(db, context, row, payload.body, None, payload.mentioned_actor_ids, payload.attachments)
    record_project_event(
        db,
        project_id=project_id,
        align_tree_id=payload.align_tree_id,
        actor=context.actor,
        event_type="review.created",
        target_type=payload.target_type,
        target_id=payload.target_id,
        summary=f"Opened review for {payload.target_label.strip()}",
    )
    db.commit()
    return _thread_read(_thread_or_404(db, project_id, row.id))


@router.post("/{thread_id}/comments", response_model=schemas.ReviewThreadRead, status_code=status.HTTP_201_CREATED)
def add_comment(
    project_id: uuid.UUID,
    thread_id: uuid.UUID,
    payload: schemas.ReviewCommentCreate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.ReviewThreadRead:
    row = _thread_or_404(db, project_id, thread_id)
    if payload.parent_comment_id is not None and not any(
        comment.id == payload.parent_comment_id for comment in row.comments
    ):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Reply comment is not in this thread")
    _create_comment(
        db, context, row, payload.body, payload.parent_comment_id,
        payload.mentioned_actor_ids, payload.attachments,
    )
    row.updated_at = datetime.now(UTC)
    db.commit()
    db.expire_all()
    return _thread_read(_thread_or_404(db, project_id, row.id))


@router.patch("/{thread_id}", response_model=schemas.ReviewThreadRead)
def update_thread(
    project_id: uuid.UUID,
    thread_id: uuid.UUID,
    payload: schemas.ReviewThreadUpdate,
    context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.ReviewThreadRead:
    row = _thread_or_404(db, project_id, thread_id)
    if ROLE_RANK[context.role] < ROLE_RANK["editor"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Editor permission is required")
    if payload.assignee_set:
        assignee = _validate_assignee(db, context, payload.assignee_actor_id)
        row.assignee_actor_id = assignee.id if assignee else None
    if payload.status is not None and payload.status != row.status:
        row.status = payload.status
        if payload.status == "resolved":
            row.resolved_by_actor_id = context.actor.id
            row.resolved_at = datetime.now(UTC)
        else:
            row.resolved_by_actor_id = None
            row.resolved_at = None
        record_project_event(
            db,
            project_id=project_id,
            align_tree_id=row.align_tree_id,
            actor=context.actor,
            event_type=f"review.{payload.status}",
            target_type=row.target_type,
            target_id=row.target_id,
            summary=f"Marked review {payload.status}: {row.target_label}",
        )
    db.commit()
    db.expire_all()
    return _thread_read(_thread_or_404(db, project_id, row.id))
