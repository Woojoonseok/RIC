from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..services.project_access import get_project_context
from ..services.validation import validate_project_graph

router = APIRouter(
    prefix="/api/projects/{project_id}/align-trees/{align_tree_id}/validate",
    tags=["validation"],
    dependencies=[Depends(get_project_context)],
)


@router.post("", response_model=schemas.ValidationReport)
def validate_project(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> schemas.ValidationReport:
    # A missing or cross-project tree is deliberately indistinguishable from
    # other inaccessible project content at the graph API boundary.
    from .. import crud

    crud.get_align_tree_or_404(db, project_id, align_tree_id)
    return validate_project_graph(db, project_id, align_tree_id)
