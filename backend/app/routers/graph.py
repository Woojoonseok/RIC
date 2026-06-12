from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..services.layout import apply_auto_layout
from ..services.relation_styles import default_relation_style_id, ensure_default_relation_styles
from ..services.validation import validate_project_graph

router = APIRouter(prefix="/api/projects/{project_id}/graph", tags=["graph"])


@router.get("", response_model=schemas.GraphRead)
def read_graph(project_id: uuid.UUID, db: Session = Depends(get_db)) -> schemas.GraphRead:
    return crud.read_graph(db, project_id)


@router.post("/layers", response_model=schemas.LayerRead, status_code=status.HTTP_201_CREATED)
def create_layer(project_id: uuid.UUID, payload: schemas.LayerCreate, db: Session = Depends(get_db)) -> models.Layer:
    try:
        return crud.create_layer(db, project_id, payload)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Layer name already exists") from exc


@router.put("/layers/{layer_id}", response_model=schemas.LayerRead)
def update_layer(
    project_id: uuid.UUID,
    layer_id: uuid.UUID,
    payload: schemas.LayerUpdate,
    db: Session = Depends(get_db),
) -> models.Layer:
    layer = crud.get_layer_or_404(db, project_id, layer_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(layer, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Layer name already exists") from exc
    db.refresh(layer)
    return layer


@router.patch("/layers/{layer_id}/layout", response_model=schemas.LayoutRead)
def update_layout(
    project_id: uuid.UUID,
    layer_id: uuid.UUID,
    payload: schemas.LayoutUpdate,
    db: Session = Depends(get_db),
) -> models.GraphLayout:
    crud.get_layer_or_404(db, project_id, layer_id)
    layout = (
        db.query(models.GraphLayout)
        .filter(models.GraphLayout.project_id == project_id, models.GraphLayout.layer_id == layer_id)
        .one_or_none()
    )
    if layout is None:
        layout = models.GraphLayout(project_id=project_id, layer_id=layer_id)
        db.add(layout)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(layout, field, value)
    db.commit()
    db.refresh(layout)
    return layout


@router.patch("/layers/{layer_id}/style", response_model=schemas.StyleRead)
def update_style(
    project_id: uuid.UUID,
    layer_id: uuid.UUID,
    payload: schemas.StyleUpdate,
    db: Session = Depends(get_db),
) -> models.ShapeStyle:
    crud.get_layer_or_404(db, project_id, layer_id)
    style_row = (
        db.query(models.ShapeStyle)
        .filter(models.ShapeStyle.project_id == project_id, models.ShapeStyle.layer_id == layer_id)
        .one_or_none()
    )
    if style_row is None:
        style_row = models.ShapeStyle(project_id=project_id, layer_id=layer_id)
        db.add(style_row)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(style_row, field, value)
    db.commit()
    db.refresh(style_row)
    return style_row


@router.get("/layers/{layer_id}/delete-preview", response_model=dict[str, list[schemas.RelationRead]])
def preview_layer_delete(project_id: uuid.UUID, layer_id: uuid.UUID, db: Session = Depends(get_db)) -> dict[str, list[models.LayerRelation]]:
    crud.get_layer_or_404(db, project_id, layer_id)
    incoming = (
        db.query(models.LayerRelation)
        .filter(models.LayerRelation.project_id == project_id, models.LayerRelation.child_layer_id == layer_id)
        .all()
    )
    outgoing = (
        db.query(models.LayerRelation)
        .filter(models.LayerRelation.project_id == project_id, models.LayerRelation.parent_layer_id == layer_id)
        .all()
    )
    return {"incoming": incoming, "outgoing": outgoing}


@router.delete("/layers/{layer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_layer(project_id: uuid.UUID, layer_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    crud.delete_layer_with_relations(db, project_id, layer_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/relation-styles", response_model=schemas.RelationStyleRead, status_code=status.HTTP_201_CREATED)
def create_relation_style(
    project_id: uuid.UUID,
    payload: schemas.RelationStyleCreate,
    db: Session = Depends(get_db),
) -> models.RelationStyle:
    crud.get_project_or_404(db, project_id)
    relation_style = models.RelationStyle(project_id=project_id, **payload.model_dump())
    db.add(relation_style)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Relation style name already exists") from exc
    db.refresh(relation_style)
    return relation_style


@router.put("/relation-styles/{style_id}", response_model=schemas.RelationStyleRead)
def update_relation_style(
    project_id: uuid.UUID,
    style_id: uuid.UUID,
    payload: schemas.RelationStyleUpdate,
    db: Session = Depends(get_db),
) -> models.RelationStyle:
    relation_style = crud.get_relation_style_or_404(db, project_id, style_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(relation_style, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Relation style name already exists") from exc
    db.refresh(relation_style)
    return relation_style


@router.delete("/relation-styles/{style_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_relation_style(project_id: uuid.UUID, style_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    relation_style = crud.get_relation_style_or_404(db, project_id, style_id)
    db.query(models.LayerRelation).filter(
        models.LayerRelation.project_id == project_id,
        models.LayerRelation.relation_style_id == style_id,
    ).update({"relation_style_id": None})
    db.delete(relation_style)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/relations", response_model=schemas.RelationRead, status_code=status.HTTP_201_CREATED)
def create_relation(
    project_id: uuid.UUID,
    payload: schemas.RelationCreate,
    db: Session = Depends(get_db),
) -> models.LayerRelation:
    crud.get_project_or_404(db, project_id)
    crud.get_layer_or_404(db, project_id, payload.parent_layer_id)
    crud.get_layer_or_404(db, project_id, payload.child_layer_id)
    data = payload.model_dump()
    if data.get("relation_style_id") is None:
        data["relation_style_id"] = default_relation_style_id(db, project_id)
    else:
        crud.get_relation_style_or_404(db, project_id, data["relation_style_id"])
    relation = models.LayerRelation(project_id=project_id, **data)
    db.add(relation)
    try:
        db.flush()
        report = validate_project_graph(db, project_id)
        if not report.ok:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=[issue.model_dump(mode="json") for issue in report.issues])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Relation already exists") from exc
    db.refresh(relation)
    return relation


@router.put("/relations/{relation_id}", response_model=schemas.RelationRead)
def update_relation(
    project_id: uuid.UUID,
    relation_id: uuid.UUID,
    payload: schemas.RelationUpdate,
    db: Session = Depends(get_db),
) -> models.LayerRelation:
    relation = crud.get_relation_or_404(db, project_id, relation_id)
    for layer_id in (payload.parent_layer_id, payload.child_layer_id):
        if layer_id is not None:
            crud.get_layer_or_404(db, project_id, layer_id)
    if payload.relation_style_id is not None:
        crud.get_relation_style_or_404(db, project_id, payload.relation_style_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(relation, field, value)
    try:
        db.flush()
        report = validate_project_graph(db, project_id)
        if not report.ok:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=[issue.model_dump(mode="json") for issue in report.issues])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Relation already exists") from exc
    db.refresh(relation)
    return relation


@router.delete("/relations/{relation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_relation(project_id: uuid.UUID, relation_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    relation = crud.get_relation_or_404(db, project_id, relation_id)
    db.delete(relation)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/text-boxes", response_model=schemas.TextBoxRead, status_code=status.HTTP_201_CREATED)
def create_text_box(project_id: uuid.UUID, payload: schemas.TextBoxCreate, db: Session = Depends(get_db)) -> models.TextBox:
    crud.get_project_or_404(db, project_id)
    text_box = models.TextBox(project_id=project_id, **payload.model_dump())
    db.add(text_box)
    db.commit()
    db.refresh(text_box)
    return text_box


@router.put("/text-boxes/{text_box_id}", response_model=schemas.TextBoxRead)
def update_text_box(
    project_id: uuid.UUID,
    text_box_id: uuid.UUID,
    payload: schemas.TextBoxUpdate,
    db: Session = Depends(get_db),
) -> models.TextBox:
    text_box = crud.get_text_box_or_404(db, project_id, text_box_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(text_box, field, value)
    db.commit()
    db.refresh(text_box)
    return text_box


@router.delete("/text-boxes/{text_box_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_text_box(project_id: uuid.UUID, text_box_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    text_box = crud.get_text_box_or_404(db, project_id, text_box_id)
    db.delete(text_box)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/auto-layout", response_model=schemas.GraphRead)
def auto_layout(project_id: uuid.UUID, db: Session = Depends(get_db)) -> schemas.GraphRead:
    crud.get_project_or_404(db, project_id)
    ensure_default_relation_styles(db, project_id)
    apply_auto_layout(db, project_id)
    db.commit()
    return crud.read_graph(db, project_id)
