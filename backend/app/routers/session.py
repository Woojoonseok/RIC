from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.identity import get_current_actor, is_system_admin

router = APIRouter(prefix="/api/me", tags=["session"])


@router.get("", response_model=schemas.ActorRead)
def read_me(actor: models.Actor = Depends(get_current_actor)) -> schemas.ActorRead:
    return schemas.ActorRead(id=actor.id, display_name=actor.display_name, is_system_admin=is_system_admin(actor))


@router.patch("", response_model=schemas.ActorRead)
def update_me(
    payload: schemas.ActorUpdate,
    actor: models.Actor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> schemas.ActorRead:
    display_name = " ".join(payload.display_name.split())
    if not display_name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Display name is required")
    actor.display_name = display_name
    db.commit()
    db.refresh(actor)
    return schemas.ActorRead(id=actor.id, display_name=actor.display_name, is_system_admin=is_system_admin(actor))
