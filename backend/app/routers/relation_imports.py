from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.project_access import (
    ProjectContext,
    get_project_context,
    project_request_guard,
    project_to_read,
)
from ..services.relation_styles import default_relation_style_id
from ..services.validation import validate_project_graph

router = APIRouter(
    prefix="/api/projects/{project_id}/align-trees/{align_tree_id}/graph/relations/import",
    tags=["relation imports"],
)


def _reference_or_error(
    db: Session,
    model: type[models.Base],
    project_id: uuid.UUID,
    row_id: uuid.UUID | None,
    label: str,
) -> Any | None:
    if row_id is None:
        return None
    row = db.get(model, row_id)
    if row is None or row.project_id != project_id:
        raise ValueError(f"{label} does not belong to this project.")
    return row


def _stage_relation(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.RelationCreate,
) -> models.LayerRelation:
    data = payload.model_dump(exclude={"extras"})
    for side in ("parent", "child"):
        type_field = f"{side}_endpoint_type"
        id_field = f"{side}_layer_id"
        endpoint_type = data.get(type_field) or "layer"
        if endpoint_type == "spare":
            data[id_field] = None
            continue
        layer_id = data.get(id_field)
        if layer_id is None:
            raise ValueError(f"{side.title()} Layer is required.")
        layer = db.get(models.Layer, layer_id)
        if layer is None or layer.project_id != project_id or layer.align_tree_id != align_tree_id:
            raise ValueError(f"{side.title()} Layer does not belong to this Editor.")

    references = (
        ("key_layout_type_id", models.KeyLayoutType, "Key Layout Type"),
        ("key_drawing_type_id", models.KeyDrawingType, "Key Drawing Type"),
        ("parent_drawing_type_id", models.KeyDrawingType, "Parent Drawing Type"),
        ("child_drawing_type_id", models.KeyDrawingType, "Child Drawing Type"),
    )
    for field, model, label in references:
        _reference_or_error(db, model, project_id, data.get(field), label)

    if data.get("attached_relation_id") is not None:
        target = db.get(models.LayerRelation, data["attached_relation_id"])
        if target is None or target.project_id != project_id or target.align_tree_id != align_tree_id:
            raise ValueError("Attached Relation does not belong to this Editor.")

    if data.get("relation_style_id") is None:
        data["relation_style_id"] = default_relation_style_id(db, project_id)
    if data.get("relation_style_id") is not None:
        style = _reference_or_error(
            db,
            models.RelationStyle,
            project_id,
            data["relation_style_id"],
            "Relation Type",
        )
        data["relation_type"] = style.name

    relation = models.LayerRelation(project_id=project_id, align_tree_id=align_tree_id, **data)
    db.add(relation)
    db.flush()
    for index, extra in enumerate(payload.extras):
        _reference_or_error(db, models.LayerMaster, project_id, extra.layer_master_id, "Extra Layer")
        _reference_or_error(db, models.KeyDrawingType, project_id, extra.key_drawing_type_id, "Extra Drawing Type")
        db.add(models.RelationExtra(
            project_id=project_id,
            relation_id=relation.id,
            layer_master_id=extra.layer_master_id,
            key_drawing_type_id=extra.key_drawing_type_id,
            sort_order=index,
        ))
    db.flush()
    return relation


def _stage_import(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.RelationImportRequest,
) -> tuple[list[models.LayerRelation], list[schemas.RelationImportIssue]]:
    created: list[models.LayerRelation] = []
    issues: list[schemas.RelationImportIssue] = []
    relation_rows: dict[uuid.UUID, int] = {}
    for item in payload.rows:
        try:
            relation = _stage_relation(db, project_id, align_tree_id, item.relation)
            created.append(relation)
            relation_rows[relation.id] = item.row_number
        except ValueError as exc:
            issues.append(schemas.RelationImportIssue(
                row_number=item.row_number,
                code="mapping_error",
                message=str(exc),
            ))

    if issues:
        return created, issues

    report = validate_project_graph(db, project_id, align_tree_id)
    for issue in report.issues:
        if issue.severity != "error" or issue.code in {"relation_parent_missing", "relation_child_missing"}:
            continue
        issues.append(schemas.RelationImportIssue(
            row_number=relation_rows.get(issue.relation_id) if issue.relation_id else None,
            code=issue.code,
            message=issue.message,
        ))
    return created, issues


@router.post("/preview", response_model=schemas.RelationImportPreview)
def preview_relation_import(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.RelationImportRequest,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.RelationImportPreview:
    crud.get_align_tree_or_404(db, project_id, align_tree_id)
    savepoint = db.begin_nested()
    try:
        created, issues = _stage_import(db, project_id, align_tree_id, payload)
    except IntegrityError:
        issues = [schemas.RelationImportIssue(
            code="duplicate_relation",
            message="The import contains a conflicting Relation.",
        )]
        created = []
    finally:
        savepoint.rollback()
    return schemas.RelationImportPreview(
        total_count=len(payload.rows),
        create_count=len(created) if not issues else 0,
        error_count=len(issues),
        issues=issues,
    )


@router.post("/commit", response_model=schemas.RelationImportCommitResult)
def commit_relation_import(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.RelationImportRequest,
    context: ProjectContext = Depends(project_request_guard),
    db: Session = Depends(get_db),
) -> schemas.RelationImportCommitResult:
    crud.get_align_tree_or_404(db, project_id, align_tree_id)
    try:
        created, issues = _stage_import(db, project_id, align_tree_id, payload)
        if issues:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=[issue.model_dump(mode="json") for issue in issues],
            )
        record_project_event(
            db,
            project_id=project_id,
            align_tree_id=align_tree_id,
            actor=context.actor,
            event_type="relation.imported",
            target_type="relation_import",
            summary=f"Imported {len(created)} layer relations",
            details={"created_count": len(created), "source_row_count": len(payload.rows)},
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except (IntegrityError, ValueError) as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Relation import failed. No rows were saved.",
        ) from exc

    graph = crud.read_graph(db, project_id, align_tree_id)
    graph.project = project_to_read(db, context.project, context.actor)
    return schemas.RelationImportCommitResult(created_count=len(created), graph=graph)
