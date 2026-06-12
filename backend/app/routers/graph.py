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


def upsert_layout(db: Session, project_id: uuid.UUID, layer_id: uuid.UUID, payload: schemas.LayoutUpdate) -> models.GraphLayout:
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
    return layout


def upsert_style(db: Session, project_id: uuid.UUID, layer_id: uuid.UUID, payload: schemas.StyleUpdate) -> models.ShapeStyle:
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
    return style_row


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


def _merge_layer_name(layers: list[models.Layer], override: str | None) -> str:
    name = override.strip() if override else "\n".join(layer.name for layer in layers)
    return name[:160]


def _port_towards(source: models.GraphLayout, target: models.GraphLayout) -> str:
    source_x = source.x + source.width / 2
    source_y = source.y + source.height / 2
    target_x = target.x + target.width / 2
    target_y = target.y + target.height / 2
    dx = target_x - source_x
    dy = target_y - source_y
    if abs(dx) >= abs(dy):
        return "right" if dx >= 0 else "left"
    return "bottom" if dy >= 0 else "top"


def _compact_values(values: list[str | None], max_length: int = 160) -> str | None:
    compacted = []
    seen = set()
    for value in values:
        normalized = (value or "").strip()
        if normalized and normalized.lower() not in seen:
            compacted.append(normalized)
            seen.add(normalized.lower())
    return "\n".join(compacted)[:max_length] if compacted else None


@router.post("/layers/merge", response_model=schemas.GraphRead)
def merge_layers(
    project_id: uuid.UUID,
    payload: schemas.LayerMergeRequest,
    db: Session = Depends(get_db),
) -> schemas.GraphRead:
    crud.get_project_or_404(db, project_id)
    layer_ids = list(dict.fromkeys(payload.layer_ids))
    if len(layer_ids) < 2:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select at least two layers to merge")

    layer_rows = (
        db.query(models.Layer)
        .filter(models.Layer.project_id == project_id, models.Layer.id.in_(layer_ids))
        .all()
    )
    layer_by_id = {layer.id: layer for layer in layer_rows}
    missing_ids = [str(layer_id) for layer_id in layer_ids if layer_id not in layer_by_id]
    if missing_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Layer not found: {', '.join(missing_ids)}")

    layers = [layer_by_id[layer_id] for layer_id in layer_ids]
    anchor = layers[0]
    selected_ids = {layer.id for layer in layers}
    original_layer_names = [layer.name for layer in layers]

    layout_rows = (
        db.query(models.GraphLayout)
        .filter(models.GraphLayout.project_id == project_id, models.GraphLayout.layer_id.in_(selected_ids))
        .all()
    )
    layout_by_layer = {layout.layer_id: layout for layout in layout_rows}
    if not all(layer.id in layout_by_layer for layer in layers):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selected layers must have layouts")

    anchor_layout = layout_by_layer[anchor.id]
    min_x = min(layout.x for layout in layout_rows) - 20
    min_y = min(layout.y for layout in layout_rows) - 20
    max_x = max(layout.x + layout.width for layout in layout_rows) + 20
    max_y = max(layout.y + layout.height for layout in layout_rows) + 20
    anchor_layout.x = min_x
    anchor_layout.y = min_y
    anchor_layout.width = max(180, max_x - min_x)
    anchor_layout.height = max(72, max_y - min_y)

    original_metadata = anchor.metadata_json or {}
    anchor.name = _merge_layer_name(layers, payload.name)
    anchor.step = _compact_values([layer.step for layer in layers], 120)
    anchor.layer_property = _compact_values([layer.layer_property for layer in layers])
    anchor.align = _compact_values([layer.align for layer in layers])
    anchor.align_side = _compact_values([layer.align_side for layer in layers], 80)
    anchor.metadata_json = {
        **original_metadata,
        "merged_layer_ids": [str(layer.id) for layer in layers],
        "merged_layer_names": original_layer_names,
    }

    all_layouts = {
        layout.layer_id: layout
        for layout in db.query(models.GraphLayout).filter(models.GraphLayout.project_id == project_id).all()
    }
    all_layouts[anchor.id] = anchor_layout
    relation_rows = db.query(models.LayerRelation).filter(models.LayerRelation.project_id == project_id).all()
    kept_keys: set[tuple[uuid.UUID, uuid.UUID]] = set()
    relation_specs: list[dict[str, object]] = []
    relations_to_delete: list[models.LayerRelation] = []

    for relation in relation_rows:
        parent_selected = relation.parent_layer_id in selected_ids
        child_selected = relation.child_layer_id in selected_ids
        next_parent = anchor.id if parent_selected else relation.parent_layer_id
        next_child = anchor.id if child_selected else relation.child_layer_id
        key = (next_parent, next_child)

        if next_parent == next_child:
            relations_to_delete.append(relation)
            continue

        if parent_selected or child_selected:
            relations_to_delete.append(relation)
            if key in kept_keys:
                continue
            source_layout = all_layouts.get(next_parent)
            target_layout = all_layouts.get(next_child)
            relation_specs.append(
                {
                    "project_id": project_id,
                    "parent_layer_id": next_parent,
                    "child_layer_id": next_child,
                    "relation_type": relation.relation_type,
                    "relation_style_id": relation.relation_style_id,
                    "source_port": _port_towards(source_layout, target_layout) if source_layout and target_layout else relation.source_port,
                    "target_port": _port_towards(target_layout, source_layout) if source_layout and target_layout else relation.target_port,
                }
            )
            kept_keys.add(key)
            continue

        if key in kept_keys:
            relations_to_delete.append(relation)
        else:
            kept_keys.add(key)

    for relation in relations_to_delete:
        db.delete(relation)
    db.flush()

    for spec in relation_specs:
        db.add(models.LayerRelation(**spec))

    for layer in layers[1:]:
        db.delete(layer)

    try:
        db.flush()
        report = validate_project_graph(db, project_id)
        if not report.ok:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=[issue.model_dump(mode="json") for issue in report.issues])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Layer merge created duplicate data") from exc
    return crud.read_graph(db, project_id)


@router.patch("/layers/{layer_id}/layout", response_model=schemas.LayoutRead)
def update_layout(
    project_id: uuid.UUID,
    layer_id: uuid.UUID,
    payload: schemas.LayoutUpdate,
    db: Session = Depends(get_db),
) -> models.GraphLayout:
    layout = upsert_layout(db, project_id, layer_id, payload)
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
    style_row = upsert_style(db, project_id, layer_id, payload)
    db.commit()
    db.refresh(style_row)
    return style_row


@router.patch("/batch", response_model=schemas.GraphRead)
def batch_update_graph(
    project_id: uuid.UUID,
    payload: schemas.GraphBatchUpdate,
    db: Session = Depends(get_db),
) -> schemas.GraphRead:
    crud.get_project_or_404(db, project_id)
    for layout_update in payload.layouts:
        upsert_layout(
            db,
            project_id,
            layout_update.layer_id,
            schemas.LayoutUpdate(**layout_update.model_dump(exclude={"layer_id"}, exclude_unset=True)),
        )
    for style_update in payload.styles:
        upsert_style(
            db,
            project_id,
            style_update.layer_id,
            schemas.StyleUpdate(**style_update.model_dump(exclude={"layer_id"}, exclude_unset=True)),
        )
    for text_box_update in payload.text_boxes:
        text_box = crud.get_text_box_or_404(db, project_id, text_box_update.id)
        for field, value in text_box_update.model_dump(exclude={"id"}, exclude_unset=True).items():
            setattr(text_box, field, value)
    db.commit()
    return crud.read_graph(db, project_id)


@router.post("/box-presets", response_model=schemas.BoxPresetRead, status_code=status.HTTP_201_CREATED)
def create_box_preset(
    project_id: uuid.UUID,
    payload: schemas.BoxPresetCreate,
    db: Session = Depends(get_db),
) -> models.BoxPreset:
    crud.get_project_or_404(db, project_id)
    if payload.is_default:
        db.query(models.BoxPreset).filter(models.BoxPreset.project_id == project_id).update({"is_default": False})
    preset = models.BoxPreset(project_id=project_id, **payload.model_dump())
    db.add(preset)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Box preset name already exists") from exc
    db.refresh(preset)
    return preset


@router.put("/box-presets/{preset_id}", response_model=schemas.BoxPresetRead)
def update_box_preset(
    project_id: uuid.UUID,
    preset_id: uuid.UUID,
    payload: schemas.BoxPresetUpdate,
    db: Session = Depends(get_db),
) -> models.BoxPreset:
    preset = crud.get_box_preset_or_404(db, project_id, preset_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("is_default") is True:
        db.query(models.BoxPreset).filter(
            models.BoxPreset.project_id == project_id,
            models.BoxPreset.id != preset_id,
        ).update({"is_default": False})
    for field, value in data.items():
        setattr(preset, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Box preset name already exists") from exc
    db.refresh(preset)
    return preset


@router.delete("/box-presets/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_box_preset(project_id: uuid.UUID, preset_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    preset = crud.get_box_preset_or_404(db, project_id, preset_id)
    was_default = preset.is_default
    db.delete(preset)
    db.flush()
    if was_default:
        next_preset = (
            db.query(models.BoxPreset)
            .filter(models.BoxPreset.project_id == project_id)
            .order_by(models.BoxPreset.sort_order, models.BoxPreset.created_at)
            .first()
        )
        if next_preset is not None:
            next_preset.is_default = True
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
