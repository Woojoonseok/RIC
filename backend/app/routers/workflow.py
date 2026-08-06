from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.project_access import (
    ProjectContext,
    get_project_context,
    require_project_admin_mutation,
    require_project_mutation,
)
from ..services.validation import validate_project_graph
from .snapshots import _graph_restore, _tree_state

router = APIRouter(
    prefix="/api/projects/{project_id}/align-trees/{align_tree_id}/workflow",
    tags=["workflow"],
)


def _tree_or_404(db: Session, project_id: uuid.UUID, align_tree_id: uuid.UUID) -> models.AlignTree:
    tree = db.get(models.AlignTree, align_tree_id)
    if tree is None or tree.project_id != project_id or tree.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Align Tree not found")
    return tree


def _require_state(tree: models.AlignTree, *allowed: str) -> None:
    if tree.workflow_status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": f"Workflow action is not available from {tree.workflow_status}",
                "workflow_status": tree.workflow_status,
            },
        )


def _record_transition(
    db: Session,
    context: ProjectContext,
    tree: models.AlignTree,
    previous: str,
    note: str,
) -> None:
    record_project_event(
        db,
        project_id=tree.project_id,
        align_tree_id=tree.id,
        actor=context.actor,
        event_type=f"workflow.{tree.workflow_status}",
        target_type="align_tree",
        target_id=tree.id,
        summary=f"Workflow changed from {previous} to {tree.workflow_status}",
        details={
            "before": {"workflow_status": previous},
            "after": {"workflow_status": tree.workflow_status, "note": note},
        },
    )


def _validation_gate(db: Session, project_id: uuid.UUID, align_tree_id: uuid.UUID) -> None:
    report = validate_project_graph(db, project_id, align_tree_id)
    errors = [issue.model_dump(mode="json") for issue in report.issues if issue.severity == "error"]
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "Validation errors must be resolved before review", "issues": errors},
        )


def _approval_snapshot(
    db: Session,
    context: ProjectContext,
    tree: models.AlignTree,
    note: str,
    now: datetime,
) -> models.GraphSnapshot:
    graph = _graph_restore(db, tree.project_id, tree.id)
    row = models.GraphSnapshot(
        project_id=tree.project_id,
        align_tree_id=tree.id,
        name=f"Approved {now.astimezone(UTC).strftime('%Y-%m-%d %H:%M UTC')}",
        description=note,
        created_by_actor_id=context.actor.id,
        created_by_label=context.actor.display_name,
        project_revision=context.project.revision,
        graph_json=graph.model_dump(mode="json"),
        tree_json=_tree_state(tree),
        summary_json={
            "layers": len(graph.layers),
            "relations": len(graph.relations),
            "text_boxes": len(graph.text_boxes),
        },
    )
    db.add(row)
    db.flush()
    return row


@router.get("", response_model=schemas.AlignTreeRead)
def read_workflow(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> models.AlignTree:
    return _tree_or_404(db, project_id, align_tree_id)


@router.post("/request-review", response_model=schemas.AlignTreeRead)
def request_review(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.WorkflowTransitionRequest,
    context: ProjectContext = Depends(require_project_mutation),
    db: Session = Depends(get_db),
) -> models.AlignTree:
    tree = _tree_or_404(db, project_id, align_tree_id)
    _require_state(tree, "draft")
    _validation_gate(db, project_id, align_tree_id)
    now = datetime.now(UTC)
    previous = tree.workflow_status
    tree.workflow_status = "in_review"
    tree.workflow_note = payload.note.strip()
    tree.review_requested_by_actor_id = context.actor.id
    tree.review_requested_by_label = context.actor.display_name
    tree.review_requested_at = now
    tree.reviewed_by_actor_id = None
    tree.reviewed_by_label = None
    tree.reviewed_at = None
    tree.approved_snapshot_id = None
    _record_transition(db, context, tree, previous, tree.workflow_note)
    db.commit()
    db.refresh(tree)
    return tree


@router.post("/reject", response_model=schemas.AlignTreeRead)
def reject_review(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.WorkflowTransitionRequest,
    context: ProjectContext = Depends(require_project_admin_mutation),
    db: Session = Depends(get_db),
) -> models.AlignTree:
    tree = _tree_or_404(db, project_id, align_tree_id)
    _require_state(tree, "in_review")
    now = datetime.now(UTC)
    previous = tree.workflow_status
    tree.workflow_status = "draft"
    tree.workflow_note = payload.note.strip()
    tree.reviewed_by_actor_id = context.actor.id
    tree.reviewed_by_label = context.actor.display_name
    tree.reviewed_at = now
    tree.approved_snapshot_id = None
    _record_transition(db, context, tree, previous, tree.workflow_note)
    db.commit()
    db.refresh(tree)
    return tree


@router.post("/approve", response_model=schemas.AlignTreeRead)
def approve_review(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.WorkflowTransitionRequest,
    context: ProjectContext = Depends(require_project_admin_mutation),
    db: Session = Depends(get_db),
) -> models.AlignTree:
    tree = _tree_or_404(db, project_id, align_tree_id)
    _require_state(tree, "in_review")
    _validation_gate(db, project_id, align_tree_id)
    now = datetime.now(UTC)
    snapshot = _approval_snapshot(db, context, tree, payload.note.strip(), now)
    previous = tree.workflow_status
    tree.workflow_status = "approved"
    tree.workflow_note = payload.note.strip()
    tree.reviewed_by_actor_id = context.actor.id
    tree.reviewed_by_label = context.actor.display_name
    tree.reviewed_at = now
    tree.approved_snapshot_id = snapshot.id
    _record_transition(db, context, tree, previous, tree.workflow_note)
    db.commit()
    db.refresh(tree)
    return tree


@router.post("/publish", response_model=schemas.AlignTreeRead)
def publish_review(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.WorkflowTransitionRequest,
    context: ProjectContext = Depends(require_project_admin_mutation),
    db: Session = Depends(get_db),
) -> models.AlignTree:
    tree = _tree_or_404(db, project_id, align_tree_id)
    _require_state(tree, "approved")
    if tree.approved_snapshot_id is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Approved snapshot is missing")
    now = datetime.now(UTC)
    previous = tree.workflow_status
    tree.workflow_status = "published"
    tree.workflow_note = payload.note.strip()
    tree.published_snapshot_id = tree.approved_snapshot_id
    tree.published_by_actor_id = context.actor.id
    tree.published_by_label = context.actor.display_name
    tree.published_at = now
    _record_transition(db, context, tree, previous, tree.workflow_note)
    db.commit()
    db.refresh(tree)
    return tree


@router.post("/reopen", response_model=schemas.AlignTreeRead)
def reopen_draft(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.WorkflowTransitionRequest,
    context: ProjectContext = Depends(require_project_mutation),
    db: Session = Depends(get_db),
) -> models.AlignTree:
    tree = _tree_or_404(db, project_id, align_tree_id)
    _require_state(tree, "approved", "published")
    previous = tree.workflow_status
    tree.workflow_status = "draft"
    tree.workflow_note = payload.note.strip()
    tree.approved_snapshot_id = None
    _record_transition(db, context, tree, previous, tree.workflow_note)
    db.commit()
    db.refresh(tree)
    return tree
