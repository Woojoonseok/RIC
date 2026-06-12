from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..services.validation import validate_project_graph

router = APIRouter(prefix="/api/projects/{project_id}/validate", tags=["validation"])


@router.post("", response_model=schemas.ValidationReport)
def validate_project(project_id: uuid.UUID, db: Session = Depends(get_db)) -> schemas.ValidationReport:
    return validate_project_graph(db, project_id)
