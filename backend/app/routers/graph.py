from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..services.layout import apply_auto_layout
from ..services.relation_styles import default_relation_style_id, ensure_default_relation_styles
from ..services.validation import validate_project_graph

router = APIRouter(prefix="/api/projects/{project_id}/graph", tags=["graph"])


def _blocking_issues(report: schemas.ValidationReport) -> list[schemas.ValidationIssue]:
    draft_codes = {"relation_parent_missing", "relation_child_missing"}
    return [issue for issue in report.issues if issue.severity == "error" and issue.code not in draft_codes]


@router.get("", response_model=schemas.GraphRead)
def read_graph(project_id: uuid.UUID, db: Session = Depends(get_db)) -> schemas.GraphRead:
    return crud.read_graph(db, project_id)


def _uuid_or_none(value: Any) -> uuid.UUID | None:
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _unique_layer_name(db: Session, project_id: uuid.UUID, base_name: str, ignore_id: uuid.UUID | None = None) -> str:
    base = (base_name or "Layer").strip()[:150] or "Layer"
    names = {
        layer.name.strip().lower()
        for layer in db.query(models.Layer).filter(models.Layer.project_id == project_id).all()
        if ignore_id is None or layer.id != ignore_id
    }
    if base.lower() not in names:
        return base
    index = 2
    while True:
        candidate = f"{base} {index}"[:160]
        if candidate.lower() not in names:
            return candidate
        index += 1


def _drop_merge_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    next_metadata = dict(metadata or {})
    for key in ("merged_layer_ids", "merged_layer_names", "merged_layers", "merged_relations"):
        next_metadata.pop(key, None)
    return next_metadata


def _group_members(db: Session, project_id: uuid.UUID, layer_id: uuid.UUID) -> tuple[str | None, set[uuid.UUID]]:
    relations = db.query(models.LayerRelation).filter(
        models.LayerRelation.project_id == project_id,
        models.LayerRelation.same_group.is_not(None),
        models.LayerRelation.same_group != "",
    ).all()
    label = next((row.same_group for row in relations if row.parent_layer_id == layer_id or row.child_layer_id == layer_id), None)
    if not label:
        return None, {layer_id}
    members: set[uuid.UUID] = set()
    for row in relations:
        if row.same_group == label:
            if row.parent_layer_id:
                members.add(row.parent_layer_id)
            if row.child_layer_id:
                members.add(row.child_layer_id)
    return label, members or {layer_id}


def _dump_layer(layer: models.Layer, layout: models.GraphLayout | None, style: models.ShapeStyle | None) -> dict[str, Any]:
    return {
        "id": str(layer.id),
        "name": layer.name,
        "step": layer.step,
        "layer_property": layer.layer_property,
        "align": layer.align,
        "align_side": layer.align_side,
        "description": layer.description,
        "metadata_json": layer.metadata_json or {},
        "box_preset_id": str(layer.box_preset_id) if layer.box_preset_id else None,
        "pending_group": layer.pending_group,
        "layout": {
            "x": layout.x,
            "y": layout.y,
            "width": layout.width,
            "height": layout.height,
            "z_index": layout.z_index,
        } if layout else None,
        "style": {
            "fill_color": style.fill_color,
            "stroke_color": style.stroke_color,
            "text_color": style.text_color,
            "font_size": style.font_size,
            "stroke_width": style.stroke_width,
        } if style else None,
    }


def _dump_relation(relation: models.LayerRelation) -> dict[str, Any]:
    return {
        "id": str(relation.id),
        "parent_layer_id": str(relation.parent_layer_id) if relation.parent_layer_id else None,
        "child_layer_id": str(relation.child_layer_id) if relation.child_layer_id else None,
        "relation_type": relation.relation_type,
        "instance": relation.instance,
        "relation_style_id": str(relation.relation_style_id) if relation.relation_style_id else None,
        "source_port": relation.source_port,
        "target_port": relation.target_port,
        "same_group": relation.same_group,
        "attached_relation_id": str(relation.attached_relation_id) if relation.attached_relation_id else None,
        "waypoints": relation.waypoints or [],
    }


@router.patch("/restore", response_model=schemas.GraphRead)
def restore_graph(
    project_id: uuid.UUID,
    payload: schemas.GraphRestore,
    db: Session = Depends(get_db),
) -> schemas.GraphRead:
    crud.get_project_or_404(db, project_id)

    db.query(models.LayerRelation).filter(models.LayerRelation.project_id == project_id).delete(synchronize_session=False)
    db.query(models.GraphLayout).filter(models.GraphLayout.project_id == project_id).delete(synchronize_session=False)
    db.query(models.ShapeStyle).filter(models.ShapeStyle.project_id == project_id).delete(synchronize_session=False)
    db.query(models.TextBox).filter(models.TextBox.project_id == project_id).delete(synchronize_session=False)
    db.query(models.Layer).filter(models.Layer.project_id == project_id).delete(synchronize_session=False)
    db.flush()
    db.expunge_all()

    for layer in payload.layers:
        db.add(models.Layer(
            id=layer.id,
            project_id=project_id,
            name=layer.name,
            step=layer.step,
            layer_property=layer.layer_property,
            align=layer.align,
            align_side=layer.align_side,
            description=layer.description,
            metadata_json=layer.metadata_json,
            box_preset_id=(
                layer.box_preset_id
                if layer.box_preset_id is not None and db.get(models.BoxPreset, layer.box_preset_id)
                else None
            ),
            pending_group=layer.pending_group,
        ))
    db.flush()

    layer_ids = {layer.id for layer in payload.layers}
    relation_style_ids = {style.id for style in db.query(models.RelationStyle).all()}
    for layout in payload.layouts:
        if layout.layer_id in layer_ids:
            db.add(models.GraphLayout(
                id=layout.id,
                project_id=project_id,
                layer_id=layout.layer_id,
                x=layout.x,
                y=layout.y,
                width=layout.width,
                height=layout.height,
                z_index=layout.z_index,
            ))
    for style in payload.styles:
        if style.layer_id in layer_ids:
            db.add(models.ShapeStyle(
                id=style.id,
                project_id=project_id,
                layer_id=style.layer_id,
                fill_color=style.fill_color,
                stroke_color=style.stroke_color,
                text_color=style.text_color,
                font_size=style.font_size,
                stroke_width=style.stroke_width,
            ))
    for text_box in payload.text_boxes:
        db.add(models.TextBox(
            id=text_box.id,
            project_id=project_id,
            text=text_box.text,
            x=text_box.x,
            y=text_box.y,
            width=text_box.width,
            height=text_box.height,
            text_color=text_box.text_color,
            font_size=text_box.font_size,
            background_color=text_box.background_color,
            border_color=text_box.border_color,
            locked=text_box.locked,
        ))
    db.flush()

    relation_keys: set[tuple[uuid.UUID | None, uuid.UUID | None, str | None]] = set()
    restored_relations: dict[uuid.UUID, models.LayerRelation] = {}
    requested_attachments: dict[uuid.UUID, uuid.UUID] = {}
    for relation in payload.relations:
        if relation.parent_layer_id is not None and relation.parent_layer_id not in layer_ids:
            continue
        if relation.child_layer_id is not None and relation.child_layer_id not in layer_ids:
            continue
        if relation.parent_layer_id is not None and relation.parent_layer_id == relation.child_layer_id:
            continue
        key = (relation.parent_layer_id, relation.child_layer_id, relation.instance)
        if key in relation_keys:
            continue
        relation_keys.add(key)
        row = models.LayerRelation(
            id=relation.id,
            project_id=project_id,
            parent_layer_id=relation.parent_layer_id,
            child_layer_id=relation.child_layer_id,
            relation_type=relation.relation_type,
            instance=relation.instance,
            relation_style_id=relation.relation_style_id if relation.relation_style_id in relation_style_ids else None,
            source_port=relation.source_port,
            target_port=relation.target_port,
            same_group=relation.same_group,
            attached_relation_id=None,
            waypoints=relation.waypoints,
        )
        db.add(row)
        restored_relations[row.id] = row
        if relation.attached_relation_id:
            requested_attachments[row.id] = relation.attached_relation_id

    db.flush()
    for relation_id, attached_id in requested_attachments.items():
        if attached_id in restored_relations and attached_id != relation_id:
            restored_relations[relation_id].attached_relation_id = attached_id
    db.flush()
    report = validate_project_graph(db, project_id)
    if _blocking_issues(report):
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=[issue.model_dump(mode="json") for issue in report.issues])
    db.commit()
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


@router.patch("/layers/{layer_id}/group", response_model=schemas.GraphRead)
def update_layer_group(
    project_id: uuid.UUID,
    layer_id: uuid.UUID,
    payload: schemas.LayerGroupUpdate,
    db: Session = Depends(get_db),
) -> schemas.GraphRead:
    layer = crud.get_layer_or_404(db, project_id, layer_id)
    current_label, _members = _group_members(db, project_id, layer_id)
    if current_label:
        db.query(models.LayerRelation).filter(
            models.LayerRelation.project_id == project_id,
            models.LayerRelation.same_group == current_label,
        ).delete(synchronize_session=False)

    label = (payload.group or "").strip() or None
    layer.pending_group = None
    if label:
        group_relation = db.query(models.LayerRelation).filter(
            models.LayerRelation.project_id == project_id,
            models.LayerRelation.same_group == label,
        ).first()
        pending = db.query(models.Layer).filter(
            models.Layer.project_id == project_id,
            models.Layer.pending_group == label,
            models.Layer.id != layer_id,
        ).order_by(models.Layer.created_at).first()
        anchor_id = None
        if group_relation:
            anchor_id = group_relation.parent_layer_id or group_relation.child_layer_id
        elif pending:
            anchor_id = pending.id
            pending.pending_group = None

        if anchor_id:
            db.add(models.LayerRelation(
                project_id=project_id,
                parent_layer_id=anchor_id,
                child_layer_id=layer_id,
                relation_type="same_group",
                instance=f"same_group:{label}:{layer_id}",
                same_group=label,
                source_port="right",
                target_port="left",
            ))
        else:
            layer.pending_group = label

    db.flush()
    report = validate_project_graph(db, project_id)
    blocking = _blocking_issues(report)
    if blocking:
        db.rollback()
        raise HTTPException(status_code=422, detail=[issue.model_dump(mode="json") for issue in blocking])
    db.commit()
    return crud.read_graph(db, project_id)


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


def _merge_layers_in_db(
    db: Session,
    project_id: uuid.UUID,
    layer_ids: list[uuid.UUID],
    override_name: str | None = None,
) -> models.Layer:
    layer_rows = (
        db.query(models.Layer)
        .filter(models.Layer.project_id == project_id, models.Layer.id.in_(layer_ids))
        .all()
    )
    layer_by_id = {layer.id: layer for layer in layer_rows}
    missing_ids = [str(layer_id) for layer_id in layer_ids if layer_id not in layer_by_id]
    if missing_ids:
        raise ValueError(f"Layer not found: {', '.join(missing_ids)}")

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
        raise ValueError("Selected layers must have layouts")

    style_rows = (
        db.query(models.ShapeStyle)
        .filter(models.ShapeStyle.project_id == project_id, models.ShapeStyle.layer_id.in_(selected_ids))
        .all()
    )
    style_by_layer = {style.layer_id: style for style in style_rows}
    relation_rows = db.query(models.LayerRelation).filter(models.LayerRelation.project_id == project_id).all()
    merged_layers = [_dump_layer(layer, layout_by_layer.get(layer.id), style_by_layer.get(layer.id)) for layer in layers]
    merged_relations = [
        _dump_relation(relation)
        for relation in relation_rows
        if relation.parent_layer_id in selected_ids or relation.child_layer_id in selected_ids
    ]

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
    anchor.name = _merge_layer_name(layers, override_name)
    anchor.step = _compact_values([layer.step for layer in layers], 120)
    anchor.layer_property = _compact_values([layer.layer_property for layer in layers])
    anchor.align = _compact_values([layer.align for layer in layers])
    anchor.align_side = _compact_values([layer.align_side for layer in layers], 80)
    anchor.metadata_json = {
        **original_metadata,
        "merged_layer_ids": [str(layer.id) for layer in layers],
        "merged_layer_names": original_layer_names,
        "merged_layers": merged_layers,
        "merged_relations": merged_relations,
    }

    all_layouts = {
        layout.layer_id: layout
        for layout in db.query(models.GraphLayout).filter(models.GraphLayout.project_id == project_id).all()
    }
    all_layouts[anchor.id] = anchor_layout
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
                    "same_group": relation.same_group,
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

    db.flush()
    return anchor


@router.post("/layers/merge", response_model=schemas.GraphRead)
def merge_layers(
    project_id: uuid.UUID,
    payload: schemas.LayerMergeRequest,
    db: Session = Depends(get_db),
) -> schemas.GraphRead:
    crud.get_project_or_404(db, project_id)
    layer_ids = list(dict.fromkeys(payload.layer_ids))
    if len(layer_ids) != 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Merge accepts two individual layers or one existing group and one individual layer",
        )

    layer_rows = (
        db.query(models.Layer)
        .filter(models.Layer.project_id == project_id, models.Layer.id.in_(layer_ids))
        .all()
    )
    layer_by_id = {layer.id: layer for layer in layer_rows}
    missing_ids = [str(layer_id) for layer_id in layer_ids if layer_id not in layer_by_id]
    if missing_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Layer not found: {', '.join(missing_ids)}")

    first_label, first_members = _group_members(db, project_id, layer_ids[0])
    second_label, second_members = _group_members(db, project_id, layer_ids[1])
    if first_label and second_label:
        raise HTTPException(status_code=422, detail="Group-to-group merge is not allowed")

    existing_groups = db.query(models.LayerRelation.same_group).filter(
        models.LayerRelation.project_id == project_id,
        models.LayerRelation.same_group.is_not(None),
        models.LayerRelation.same_group != ""
    ).all()
    group_numbers = []
    for g in existing_groups:
        try:
            group_numbers.append(int(g[0]))
        except ValueError:
            pass
    group_label = first_label or second_label or (str(max(group_numbers) + 1) if group_numbers else "1")
    existing_members = first_members if first_label else second_members if second_label else {layer_ids[0]}
    new_member = layer_ids[1] if first_label or not second_label else layer_ids[0]
    anchor_id = next(iter(existing_members))
    db.add(models.LayerRelation(
        project_id=project_id,
        parent_layer_id=anchor_id,
        child_layer_id=new_member,
        relation_type="same_group",
        instance=f"same_group:{group_label}",
        same_group=group_label,
        source_port="right",
        target_port="left",
    ))
    all_member_ids = existing_members | {new_member}
    db.query(models.Layer).filter(models.Layer.id.in_(all_member_ids)).update(
        {"pending_group": None}, synchronize_session=False
    )

    # Align layouts of all group members to the group bounding box
    layout_rows = (
        db.query(models.GraphLayout)
        .filter(models.GraphLayout.project_id == project_id, models.GraphLayout.layer_id.in_(all_member_ids))
        .all()
    )
    if layout_rows:
        min_x = min(row.x for row in layout_rows)
        min_y = min(row.y for row in layout_rows)
        max_x = max(row.x + row.width for row in layout_rows)
        max_y = max(row.y + row.height for row in layout_rows)
        new_w = max(180, max_x - min_x)
        new_h = max(72, max_y - min_y)
        
        for row in layout_rows:
            row.x = min_x
            row.y = min_y
            row.width = new_w
            row.height = new_h

    try:
        db.flush()
        report = validate_project_graph(db, project_id)
        if _blocking_issues(report):
            db.rollback()
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=[issue.model_dump(mode="json") for issue in report.issues])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Layer merge created duplicate data") from exc
    return crud.read_graph(db, project_id)


@router.post("/layers/{layer_id}/split", response_model=schemas.GraphRead)
def split_layer(
    project_id: uuid.UUID,
    layer_id: uuid.UUID,
    payload: schemas.LayerSplitRequest,
    db: Session = Depends(get_db),
) -> schemas.GraphRead:
    layer = crud.get_layer_or_404(db, project_id, layer_id)
    metadata = dict(layer.metadata_json or {})
    stored_layers = metadata.get("merged_layers")
    stored_relations = metadata.get("merged_relations")
    stored_names = metadata.get("merged_layer_names")

    is_legacy_merged = (isinstance(stored_layers, list) and len(stored_layers) >= 2) or (not stored_layers and layer.name and "\n" in layer.name)

    if not is_legacy_merged:
        # New non-destructive split logic: delete same_group relations involving this layer's group
        group_rels = db.query(models.LayerRelation).filter(
            models.LayerRelation.project_id == project_id,
            (models.LayerRelation.parent_layer_id == layer_id) | (models.LayerRelation.child_layer_id == layer_id),
            models.LayerRelation.same_group.is_not(None),
            models.LayerRelation.same_group != ""
        ).all()
        if not group_rels:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selected layer is not a merged/grouped layer")
        
        group_ids = {r.same_group for r in group_rels}
        all_group_rels = db.query(models.LayerRelation).filter(
            models.LayerRelation.project_id == project_id,
            models.LayerRelation.same_group.in_(group_ids)
        ).all()
        for r in all_group_rels:
            db.delete(r)
        db.flush()
        report = validate_project_graph(db, project_id)
        if _blocking_issues(report):
            db.rollback()
            raise HTTPException(status_code=422, detail=[issue.model_dump(mode="json") for issue in report.issues])
        db.commit()
        return crud.read_graph(db, project_id)

    if not isinstance(stored_layers, list):
        names = stored_names if isinstance(stored_names, list) else layer.name.splitlines()
        stored_layers = [{"id": str(uuid.uuid4()), "name": name} for name in names if str(name).strip()]
    if len(stored_layers) < 2:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selected layer is not a merged layer")

    anchor_layout = (
        db.query(models.GraphLayout)
        .filter(models.GraphLayout.project_id == project_id, models.GraphLayout.layer_id == layer_id)
        .one_or_none()
    )
    if anchor_layout is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Merged layer must have a layout")
    anchor_style = (
        db.query(models.ShapeStyle)
        .filter(models.ShapeStyle.project_id == project_id, models.ShapeStyle.layer_id == layer_id)
        .one_or_none()
    )

    stored_layouts = [item.get("layout") for item in stored_layers if isinstance(item, dict) and isinstance(item.get("layout"), dict)]
    original_min_x = min((layout["x"] for layout in stored_layouts if "x" in layout), default=anchor_layout.x)
    original_min_y = min((layout["y"] for layout in stored_layouts if "y" in layout), default=anchor_layout.y)
    original_to_new: dict[uuid.UUID, uuid.UUID] = {}
    new_layer_ids: list[uuid.UUID] = []

    def split_position(item: dict[str, Any], index: int) -> dict[str, float | int]:
        source_layout = item.get("layout") if isinstance(item.get("layout"), dict) else {}
        if source_layout:
            return {
                "x": anchor_layout.x + 20 + float(source_layout.get("x", original_min_x)) - float(original_min_x),
                "y": anchor_layout.y + 20 + float(source_layout.get("y", original_min_y)) - float(original_min_y),
                "width": max(60, float(source_layout.get("width", 180))),
                "height": max(36, float(source_layout.get("height", 72))),
                "z_index": int(source_layout.get("z_index", index)),
            }
        gap = 36
        if payload.orientation == "horizontal":
            width = max(120, (anchor_layout.width - gap * (len(stored_layers) - 1)) / len(stored_layers))
            return {"x": anchor_layout.x + index * (width + gap), "y": anchor_layout.y, "width": width, "height": max(72, anchor_layout.height), "z_index": index}
        height = max(60, (anchor_layout.height - gap * (len(stored_layers) - 1)) / len(stored_layers))
        return {"x": anchor_layout.x, "y": anchor_layout.y + index * (height + gap), "width": max(180, anchor_layout.width), "height": height, "z_index": index}

    for index, raw_item in enumerate(stored_layers):
        item = raw_item if isinstance(raw_item, dict) else {"id": str(uuid.uuid4()), "name": str(raw_item)}
        original_id = _uuid_or_none(item.get("id")) or uuid.uuid4()
        next_id = layer_id if index == 0 else original_id
        if index > 0 and db.get(models.Layer, next_id) is not None:
            next_id = uuid.uuid4()
        original_to_new[original_id] = next_id
        new_layer_ids.append(next_id)

        item_metadata = _drop_merge_metadata(item.get("metadata_json") if isinstance(item.get("metadata_json"), dict) else {})
        layout_payload = split_position(item, index)
        style_payload = item.get("style") if isinstance(item.get("style"), dict) else {}

        if index == 0:
            layer.name = _unique_layer_name(db, project_id, str(item.get("name") or "Layer"), ignore_id=layer_id)
            layer.step = item.get("step")
            layer.layer_property = item.get("layer_property")
            layer.align = item.get("align")
            layer.align_side = item.get("align_side")
            layer.metadata_json = item_metadata
            anchor_layout.x = float(layout_payload["x"])
            anchor_layout.y = float(layout_payload["y"])
            anchor_layout.width = float(layout_payload["width"])
            anchor_layout.height = float(layout_payload["height"])
            anchor_layout.z_index = int(layout_payload["z_index"])
            if anchor_style is None:
                anchor_style = models.ShapeStyle(project_id=project_id, layer_id=layer_id)
                db.add(anchor_style)
            anchor_style.fill_color = str(style_payload.get("fill_color", anchor_style.fill_color))
            anchor_style.stroke_color = str(style_payload.get("stroke_color", anchor_style.stroke_color))
            anchor_style.text_color = str(style_payload.get("text_color", anchor_style.text_color))
            anchor_style.font_size = int(style_payload.get("font_size", anchor_style.font_size))
            anchor_style.stroke_width = int(style_payload.get("stroke_width", anchor_style.stroke_width))
            continue

        new_layer = models.Layer(
            id=next_id,
            project_id=project_id,
            name=_unique_layer_name(db, project_id, str(item.get("name") or "Layer")),
            step=item.get("step"),
            layer_property=item.get("layer_property"),
            align=item.get("align"),
            align_side=item.get("align_side"),
            metadata_json=item_metadata,
        )
        db.add(new_layer)
        db.flush()
        db.add(models.GraphLayout(
            project_id=project_id,
            layer_id=next_id,
            x=float(layout_payload["x"]),
            y=float(layout_payload["y"]),
            width=float(layout_payload["width"]),
            height=float(layout_payload["height"]),
            z_index=int(layout_payload["z_index"]),
        ))
        db.add(models.ShapeStyle(
            project_id=project_id,
            layer_id=next_id,
            fill_color=str(style_payload.get("fill_color", anchor_style.fill_color if anchor_style else "#ffffff")),
            stroke_color=str(style_payload.get("stroke_color", anchor_style.stroke_color if anchor_style else "#2563eb")),
            text_color=str(style_payload.get("text_color", anchor_style.text_color if anchor_style else "#111827")),
            font_size=int(style_payload.get("font_size", anchor_style.font_size if anchor_style else 14)),
            stroke_width=int(style_payload.get("stroke_width", anchor_style.stroke_width if anchor_style else 2)),
        ))

    current_touching = (
        db.query(models.LayerRelation)
        .filter(
            models.LayerRelation.project_id == project_id,
            (models.LayerRelation.parent_layer_id == layer_id) | (models.LayerRelation.child_layer_id == layer_id),
        )
        .all()
    )
    fallback_relations = [_dump_relation(relation) for relation in current_touching]
    for relation in current_touching:
        db.delete(relation)
    db.flush()

    existing_layer_ids = {row.id for row in db.query(models.Layer).filter(models.Layer.project_id == project_id).all()}
    relation_style_ids = {row.id for row in db.query(models.RelationStyle).all()}
    existing_keys = {
        (relation.parent_layer_id, relation.child_layer_id)
        for relation in db.query(models.LayerRelation).filter(models.LayerRelation.project_id == project_id).all()
    }

    relation_specs = stored_relations if isinstance(stored_relations, list) and stored_relations else []
    if not relation_specs:
        relation_specs = []
        for index in range(len(new_layer_ids) - 1):
            relation_specs.append({
                "parent_layer_id": str(new_layer_ids[index]),
                "child_layer_id": str(new_layer_ids[index + 1]),
                "relation_type": "parent_child",
                "relation_style_id": default_relation_style_id(db, project_id),
                "source_port": "bottom" if payload.orientation == "vertical" else "right",
                "target_port": "top" if payload.orientation == "vertical" else "left",
            })
        for relation in fallback_relations:
            parent_id = _uuid_or_none(relation.get("parent_layer_id"))
            child_id = _uuid_or_none(relation.get("child_layer_id"))
            relation_specs.append({
                **relation,
                "parent_layer_id": str(new_layer_ids[-1] if parent_id == layer_id else parent_id),
                "child_layer_id": str(new_layer_ids[0] if child_id == layer_id else child_id),
            })

    for raw_relation in relation_specs:
        if not isinstance(raw_relation, dict):
            continue
        original_parent = _uuid_or_none(raw_relation.get("parent_layer_id"))
        original_child = _uuid_or_none(raw_relation.get("child_layer_id"))
        parent_id = original_to_new.get(original_parent, original_parent)
        child_id = original_to_new.get(original_child, original_child)
        if not parent_id or not child_id or parent_id == child_id:
            continue
        if parent_id not in existing_layer_ids or child_id not in existing_layer_ids:
            continue
        key = (parent_id, child_id)
        if key in existing_keys:
            continue
        relation_id = _uuid_or_none(raw_relation.get("id")) or uuid.uuid4()
        if db.get(models.LayerRelation, relation_id) is not None:
            relation_id = uuid.uuid4()
        relation_style_id = _uuid_or_none(raw_relation.get("relation_style_id"))
        db.add(models.LayerRelation(
            id=relation_id,
            project_id=project_id,
            parent_layer_id=parent_id,
            child_layer_id=child_id,
            relation_type=str(raw_relation.get("relation_type") or "parent_child"),
            relation_style_id=relation_style_id if relation_style_id in relation_style_ids else None,
            source_port=str(raw_relation.get("source_port") or "right"),
            target_port=str(raw_relation.get("target_port") or "left"),
        ))
        existing_keys.add(key)

    try:
        db.flush()
        report = validate_project_graph(db, project_id)
        if _blocking_issues(report):
            db.rollback()
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=[issue.model_dump(mode="json") for issue in report.issues])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Layer split created duplicate data") from exc
    return crud.read_graph(db, project_id)


@router.patch("/layers/{layer_id}/layout", response_model=schemas.LayoutRead)
def update_layout(
    project_id: uuid.UUID,
    layer_id: uuid.UUID,
    payload: schemas.LayoutUpdate,
    db: Session = Depends(get_db),
) -> models.GraphLayout:
    _label, member_ids = _group_members(db, project_id, layer_id)
    rows = [upsert_layout(db, project_id, member_id, payload) for member_id in member_ids]
    layout = next(row for row in rows if row.layer_id == layer_id)
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
    _label, member_ids = _group_members(db, project_id, layer_id)
    rows = [upsert_style(db, project_id, member_id, payload) for member_id in member_ids]
    style_row = next(row for row in rows if row.layer_id == layer_id)
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
        _label, member_ids = _group_members(db, project_id, layout_update.layer_id)
        for member_id in member_ids:
            upsert_layout(
                db,
                project_id,
                member_id,
                schemas.LayoutUpdate(**layout_update.model_dump(exclude={"layer_id"}, exclude_unset=True)),
            )
    for style_update in payload.styles:
        _label, member_ids = _group_members(db, project_id, style_update.layer_id)
        for member_id in member_ids:
            upsert_style(
                db,
                project_id,
                member_id,
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
        db.query(models.BoxPreset).update({"is_default": False})
    preset = models.BoxPreset(**payload.model_dump())
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
        db.query(models.BoxPreset).filter(models.BoxPreset.id != preset_id).update({"is_default": False})
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
            .order_by(models.BoxPreset.sort_order, models.BoxPreset.name)
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
    relation_style = models.RelationStyle(**payload.model_dump())
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
    if payload.parent_layer_id is not None:
        crud.get_layer_or_404(db, project_id, payload.parent_layer_id)
    if payload.child_layer_id is not None:
        crud.get_layer_or_404(db, project_id, payload.child_layer_id)
    data = payload.model_dump()
    if data.get("relation_style_id") is None:
        data["relation_style_id"] = default_relation_style_id(db, project_id)
    else:
        crud.get_relation_style_or_404(db, project_id, data["relation_style_id"])
    parent_ids = {payload.parent_layer_id} if payload.parent_layer_id else {None}
    child_ids = {payload.child_layer_id} if payload.child_layer_id else {None}
    if payload.parent_layer_id and payload.child_layer_id and not payload.same_group:
        parent_label, parent_members = _group_members(db, project_id, payload.parent_layer_id)
        child_label, child_members = _group_members(db, project_id, payload.child_layer_id)
        if parent_label and child_label:
            raise HTTPException(status_code=422, detail="Group-to-group relation is not allowed")
        parent_ids = parent_members if parent_label else parent_ids
        child_ids = child_members if child_label else child_ids

    created: list[models.LayerRelation] = []
    for parent_id in parent_ids:
        for child_id in child_ids:
            if parent_id is not None and parent_id == child_id:
                continue
            exists = db.query(models.LayerRelation).filter(
                models.LayerRelation.project_id == project_id,
                models.LayerRelation.parent_layer_id == parent_id,
                models.LayerRelation.child_layer_id == child_id,
                models.LayerRelation.instance == payload.instance,
            ).first()
            if exists:
                continue
            relation = models.LayerRelation(
                project_id=project_id,
                **{**data, "parent_layer_id": parent_id, "child_layer_id": child_id},
            )
            db.add(relation)
            created.append(relation)
    if not created:
        raise HTTPException(status_code=409, detail="Relation already exists")
    try:
        db.flush()
        report = validate_project_graph(db, project_id)
        if payload.parent_layer_id is not None and payload.child_layer_id is not None and _blocking_issues(report):
            db.rollback()
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=[issue.model_dump(mode="json") for issue in report.issues])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Relation already exists") from exc
    db.refresh(created[0])
    return created[0]


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
        if relation.parent_layer_id is not None and relation.child_layer_id is not None and _blocking_issues(report):
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
    ensure_default_relation_styles(db)
    apply_auto_layout(db, project_id)
    db.commit()
    return crud.read_graph(db, project_id)
