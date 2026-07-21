import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.project_access import ProjectContext, get_project_admin_context

router = APIRouter(prefix="/api/projects/{project_id}/users", tags=["project users"])


@router.get("", response_model=list[schemas.ActorSummary])
def list_users(
    project_id: uuid.UUID,
    query: str = Query(min_length=2, max_length=120),
    _context: ProjectContext = Depends(get_project_admin_context),
    db: Session = Depends(get_db),
) -> list[schemas.ActorSummary]:
    normalized = query.strip()
    if len(normalized) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Search query must contain at least 2 non-whitespace characters",
        )
    statement = db.query(models.Actor).filter(models.Actor.display_name.ilike(f"%{normalized}%"))
    actors = statement.order_by(models.Actor.display_name, models.Actor.id).limit(50).all()
    return [schemas.ActorSummary(id=actor.id, display_name=actor.display_name) for actor in actors]
