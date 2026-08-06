from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.project_access import (
    ProjectContext,
    get_project_context,
    project_request_guard,
)
from .project_layer_master import _apply_priorities, _normalize_group, _serialize

router = APIRouter(
    prefix="/api/projects/{project_id}/layer-master/import",
    tags=["layer master imports"],
)


def _stage_import(
    db: Session,
    project_id: uuid.UUID,
    payload: schemas.LayerMasterImportRequest,
) -> tuple[list[models.LayerMaster], list[schemas.LayerMasterImportIssue]]:
    existing_names = {
        row.name
        for row in db.query(models.LayerMaster.name).filter(models.LayerMaster.project_id == project_id).all()
    }
    valid_type_ids = {
        row.id
        for row in db.query(models.KeyLayoutType.id).filter(models.KeyLayoutType.project_id == project_id).all()
    }
    seen_names: set[str] = set()
    created: list[models.LayerMaster] = []
    issues: list[schemas.LayerMasterImportIssue] = []

    for item in payload.rows:
        name = item.layer.name.strip()
        layer_number = item.layer.layer_number.strip()
        row_issues: list[schemas.LayerMasterImportIssue] = []
        if not name:
            row_issues.append(schemas.LayerMasterImportIssue(
                row_number=item.row_number,
                code="name_required",
                message="Layer name is required.",
            ))
        elif name in existing_names or name in seen_names:
            row_issues.append(schemas.LayerMasterImportIssue(
                row_number=item.row_number,
                code="duplicate_name",
                message=f"Layer name '{name}' already exists in this project or import.",
            ))
        if not layer_number:
            row_issues.append(schemas.LayerMasterImportIssue(
                row_number=item.row_number,
                code="layer_number_required",
                message="Layer number is required.",
            ))
        if set(item.layer.priorities) - valid_type_ids:
            row_issues.append(schemas.LayerMasterImportIssue(
                row_number=item.row_number,
                code="unknown_key_layout_type",
                message="A Key Layout Type does not belong to this project.",
            ))
        if row_issues:
            issues.extend(row_issues)
            if name:
                seen_names.add(name)
            continue

        data = item.layer.model_dump(exclude={"priorities"})
        data["name"] = name
        data["layer_number"] = layer_number
        data["group"] = _normalize_group(data.get("group"))
        row = models.LayerMaster(project_id=project_id, **data)
        db.add(row)
        db.flush()
        _apply_priorities(db, project_id, row, item.layer.priorities)
        db.flush()
        created.append(row)
        seen_names.add(name)

    return created, issues


@router.post("/preview", response_model=schemas.LayerMasterImportPreview)
def preview_layer_master_import(
    project_id: uuid.UUID,
    payload: schemas.LayerMasterImportRequest,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.LayerMasterImportPreview:
    savepoint = db.begin_nested()
    try:
        created, issues = _stage_import(db, project_id, payload)
    except IntegrityError:
        created = []
        issues = [schemas.LayerMasterImportIssue(
            code="conflicting_data",
            message="The import contains conflicting Layer information.",
        )]
    finally:
        savepoint.rollback()
    return schemas.LayerMasterImportPreview(
        total_count=len(payload.rows),
        create_count=len(created) if not issues else 0,
        error_count=len(issues),
        issues=issues,
    )


@router.post("/commit", response_model=schemas.LayerMasterImportCommitResult)
def commit_layer_master_import(
    project_id: uuid.UUID,
    payload: schemas.LayerMasterImportRequest,
    context: ProjectContext = Depends(project_request_guard),
    db: Session = Depends(get_db),
) -> schemas.LayerMasterImportCommitResult:
    try:
        created, issues = _stage_import(db, project_id, payload)
        if issues:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=[issue.model_dump(mode="json") for issue in issues],
            )
        record_project_event(
            db,
            project_id=project_id,
            actor=context.actor,
            event_type="layer_master.imported",
            target_type="layer_master_import",
            summary=f"Imported {len(created)} Layer Master rows",
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
            detail="Layer information import failed. No rows were saved.",
        ) from exc

    for row in created:
        db.refresh(row)
    return schemas.LayerMasterImportCommitResult(
        created_count=len(created),
        rows=[_serialize(row) for row in created],
    )
