from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..services.audit import record_project_event
from ..services.project_access import ProjectContext, get_project_context, project_request_guard
from .graph import restore_graph

router = APIRouter(
    prefix="/api/projects/{project_id}/align-trees/{align_tree_id}/snapshots",
    tags=["graph snapshots"],
)

TREE_FIELDS = (
    "process_name",
    "gds_name",
    "layer_process_names",
    "layer_gds_names",
    "final_table_cells",
)
DIFF_LIMIT = 200


def _tree_or_404(db: Session, project_id: uuid.UUID, align_tree_id: uuid.UUID) -> models.AlignTree:
    return crud.get_align_tree_or_404(db, project_id, align_tree_id)


def _snapshot_or_404(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    snapshot_id: uuid.UUID,
) -> models.GraphSnapshot:
    snapshot = db.get(models.GraphSnapshot, snapshot_id)
    if snapshot is None or snapshot.project_id != project_id or snapshot.align_tree_id != align_tree_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    return snapshot


def _graph_restore(db: Session, project_id: uuid.UUID, align_tree_id: uuid.UUID) -> schemas.GraphRestore:
    graph = crud.read_graph(db, project_id, align_tree_id)
    return schemas.GraphRestore(
        layers=graph.layers,
        layouts=graph.layouts,
        styles=graph.styles,
        box_presets=graph.box_presets,
        relation_styles=graph.relation_styles,
        relations=graph.relations,
        text_boxes=graph.text_boxes,
    )


def _tree_state(tree: models.AlignTree) -> dict[str, Any]:
    return {field: getattr(tree, field) for field in TREE_FIELDS}


def _summary(snapshot: models.GraphSnapshot) -> schemas.SnapshotSummary:
    return schemas.SnapshotSummary(
        id=snapshot.id,
        project_id=snapshot.project_id,
        align_tree_id=snapshot.align_tree_id,
        name=snapshot.name,
        description=snapshot.description,
        created_by_actor_id=snapshot.created_by_actor_id,
        created_by_label=snapshot.created_by_label,
        project_revision=snapshot.project_revision,
        summary=snapshot.summary_json or {},
        created_at=snapshot.created_at,
    )


def _clean(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _clean(item)
            for key, item in value.items()
            if key not in {"created_at", "updated_at", "project_id", "align_tree_id"}
        }
    if isinstance(value, list):
        return [_clean(item) for item in value]
    return value


def _graph_entities(graph: dict[str, Any]) -> dict[str, dict[str, dict[str, Any]]]:
    layouts = {str(row["layer_id"]): row for row in graph.get("layouts", [])}
    styles = {str(row["layer_id"]): row for row in graph.get("styles", [])}
    layers = {
        str(row["id"]): {
            "value": _clean({"layer": row, "layout": layouts.get(str(row["id"])), "style": styles.get(str(row["id"]))}),
            "label": str(row.get("name") or row["id"]),
        }
        for row in graph.get("layers", [])
    }
    layer_names = {row_id: entry["label"] for row_id, entry in layers.items()}
    relations: dict[str, dict[str, Any]] = {}
    for row in graph.get("relations", []):
        parent = "Spare" if row.get("parent_endpoint_type") == "spare" else layer_names.get(str(row.get("parent_layer_id")), "Unknown")
        child = "Spare" if row.get("child_endpoint_type") == "spare" else layer_names.get(str(row.get("child_layer_id")), "Unknown")
        relations[str(row["id"])] = {"value": _clean(row), "label": f"{parent} → {child}"}
    text_boxes = {
        str(row["id"]): {"value": _clean(row), "label": str(row.get("text") or "도형")[:80]}
        for row in graph.get("text_boxes", [])
    }
    return {"layers": layers, "relations": relations, "text_boxes": text_boxes}


def _diff_section(
    base: dict[str, dict[str, Any]],
    target: dict[str, dict[str, Any]],
) -> schemas.SnapshotDiffSection:
    base_ids = set(base)
    target_ids = set(target)
    added = sorted(target_ids - base_ids)
    removed = sorted(base_ids - target_ids)
    modified = sorted(row_id for row_id in base_ids & target_ids if base[row_id]["value"] != target[row_id]["value"])
    item = lambda rows, row_id: schemas.SnapshotDiffItem(id=row_id, label=str(rows[row_id]["label"]))
    return schemas.SnapshotDiffSection(
        added=len(added),
        removed=len(removed),
        modified=len(modified),
        added_items=[item(target, row_id) for row_id in added[:DIFF_LIMIT]],
        removed_items=[item(base, row_id) for row_id in removed[:DIFF_LIMIT]],
        modified_items=[item(target, row_id) for row_id in modified[:DIFF_LIMIT]],
    )


def _reference_warnings(db: Session, project_id: uuid.UUID, graph: dict[str, Any]) -> list[str]:
    references = (
        (models.LayerMaster, "layer_master_id", graph.get("layers", []), "Layer 정보"),
        (models.BoxPreset, "box_preset_id", graph.get("layers", []), "Box Preset"),
        (models.RelationStyle, "relation_style_id", graph.get("relations", []), "Relation Type"),
        (models.KeyLayoutType, "key_layout_type_id", graph.get("relations", []), "Key Layout Type"),
        (models.KeyDrawingType, "key_drawing_type_id", graph.get("relations", []), "Key Drawing Type"),
    )
    warnings: list[str] = []
    for model, field, rows, label in references:
        requested = {uuid.UUID(str(row[field])) for row in rows if row.get(field)}
        if not requested:
            continue
        available = {
            row.id
            for row in db.query(model.id).filter(model.project_id == project_id, model.id.in_(requested)).all()
        }
        missing = requested - available
        if missing:
            warnings.append(f"삭제된 {label} 참조 {len(missing)}개는 복원 시 비어 있는 값으로 처리됩니다.")
    return warnings


def _diff(
    db: Session,
    project_id: uuid.UUID,
    base_graph: dict[str, Any],
    base_tree: dict[str, Any],
    base_label: schemas.SnapshotVersionLabel,
    target_graph: dict[str, Any],
    target_tree: dict[str, Any],
    target_label: schemas.SnapshotVersionLabel,
    *,
    restore_target: bool = False,
) -> schemas.SnapshotDiff:
    base_entities = _graph_entities(base_graph)
    target_entities = _graph_entities(target_graph)
    layers = _diff_section(base_entities["layers"], target_entities["layers"])
    relations = _diff_section(base_entities["relations"], target_entities["relations"])
    text_boxes = _diff_section(base_entities["text_boxes"], target_entities["text_boxes"])
    tree_fields = [field for field in TREE_FIELDS if _clean(base_tree.get(field)) != _clean(target_tree.get(field))]
    changed = any(
        section.added or section.removed or section.modified
        for section in (layers, relations, text_boxes)
    ) or bool(tree_fields)
    return schemas.SnapshotDiff(
        base=base_label,
        target=target_label,
        layers=layers,
        relations=relations,
        text_boxes=text_boxes,
        tree_fields=tree_fields,
        warnings=_reference_warnings(db, project_id, target_graph) if restore_target else [],
        has_changes=changed,
    )


def _snapshot_label(snapshot: models.GraphSnapshot) -> schemas.SnapshotVersionLabel:
    return schemas.SnapshotVersionLabel(id=snapshot.id, name=snapshot.name, created_at=snapshot.created_at)


def _current_state(
    db: Session,
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
) -> tuple[dict[str, Any], dict[str, Any], schemas.SnapshotVersionLabel]:
    tree = _tree_or_404(db, project_id, align_tree_id)
    graph = _graph_restore(db, project_id, align_tree_id).model_dump(mode="json")
    return graph, _tree_state(tree), schemas.SnapshotVersionLabel(name="현재 상태")


@router.get("", response_model=list[schemas.SnapshotSummary])
def list_snapshots(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> list[schemas.SnapshotSummary]:
    _tree_or_404(db, project_id, align_tree_id)
    rows = (
        db.query(models.GraphSnapshot)
        .filter(models.GraphSnapshot.project_id == project_id, models.GraphSnapshot.align_tree_id == align_tree_id)
        .order_by(models.GraphSnapshot.created_at.desc(), models.GraphSnapshot.id.desc())
        .all()
    )
    return [_summary(row) for row in rows]


@router.post("", response_model=schemas.SnapshotSummary, status_code=status.HTTP_201_CREATED)
def create_snapshot(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    payload: schemas.SnapshotCreate,
    context: ProjectContext = Depends(project_request_guard),
    db: Session = Depends(get_db),
) -> schemas.SnapshotSummary:
    tree = _tree_or_404(db, project_id, align_tree_id)
    graph = _graph_restore(db, project_id, align_tree_id)
    row = models.GraphSnapshot(
        project_id=project_id,
        align_tree_id=align_tree_id,
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else None,
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
    record_project_event(
        db,
        project_id=project_id,
        align_tree_id=align_tree_id,
        actor=context.actor,
        event_type="snapshot.created",
        target_type="snapshot",
        target_id=row.id,
        summary=f"Created snapshot {row.name}",
        details={"values": {"name": row.name, **row.summary_json}},
    )
    db.commit()
    db.refresh(row)
    return _summary(row)


@router.get("/{snapshot_id}", response_model=schemas.SnapshotDetail)
def get_snapshot(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.SnapshotDetail:
    row = _snapshot_or_404(db, project_id, align_tree_id, snapshot_id)
    return schemas.SnapshotDetail(
        **_summary(row).model_dump(),
        graph=schemas.GraphRestore.model_validate(row.graph_json),
        tree=row.tree_json or {},
    )


@router.get("/{snapshot_id}/compare", response_model=schemas.SnapshotDiff)
def compare_snapshot(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    target_snapshot_id: uuid.UUID | None = Query(default=None),
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.SnapshotDiff:
    base = _snapshot_or_404(db, project_id, align_tree_id, snapshot_id)
    if target_snapshot_id is None:
        target_graph, target_tree, target_label = _current_state(db, project_id, align_tree_id)
    else:
        target = _snapshot_or_404(db, project_id, align_tree_id, target_snapshot_id)
        target_graph, target_tree, target_label = target.graph_json, target.tree_json, _snapshot_label(target)
    return _diff(
        db,
        project_id,
        base.graph_json,
        base.tree_json,
        _snapshot_label(base),
        target_graph,
        target_tree,
        target_label,
    )


@router.post("/{snapshot_id}/restore/preview", response_model=schemas.SnapshotDiff)
def preview_snapshot_restore(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    _context: ProjectContext = Depends(get_project_context),
    db: Session = Depends(get_db),
) -> schemas.SnapshotDiff:
    snapshot = _snapshot_or_404(db, project_id, align_tree_id, snapshot_id)
    current_graph, current_tree, current_label = _current_state(db, project_id, align_tree_id)
    return _diff(
        db,
        project_id,
        current_graph,
        current_tree,
        current_label,
        snapshot.graph_json,
        snapshot.tree_json,
        _snapshot_label(snapshot),
        restore_target=True,
    )


@router.post("/{snapshot_id}/restore", response_model=schemas.GraphRead)
def restore_snapshot(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    context: ProjectContext = Depends(project_request_guard),
    db: Session = Depends(get_db),
) -> schemas.GraphRead:
    snapshot = _snapshot_or_404(db, project_id, align_tree_id, snapshot_id)
    payload = schemas.GraphRestore.model_validate(snapshot.graph_json)
    restore_graph(project_id, align_tree_id, payload, context, db)
    tree = _tree_or_404(db, project_id, align_tree_id)
    for field in TREE_FIELDS:
        if field in snapshot.tree_json:
            setattr(tree, field, snapshot.tree_json[field])
    record_project_event(
        db,
        project_id=project_id,
        align_tree_id=align_tree_id,
        actor=context.actor,
        event_type="snapshot.restored",
        target_type="snapshot",
        target_id=snapshot.id,
        summary=f"Restored snapshot {snapshot.name}",
        details={"values": {"name": snapshot.name, **(snapshot.summary_json or {})}},
    )
    db.commit()
    return crud.read_graph(db, project_id, align_tree_id)


@router.delete("/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_snapshot(
    project_id: uuid.UUID,
    align_tree_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    context: ProjectContext = Depends(project_request_guard),
    db: Session = Depends(get_db),
) -> None:
    snapshot = _snapshot_or_404(db, project_id, align_tree_id, snapshot_id)
    name = snapshot.name
    db.delete(snapshot)
    record_project_event(
        db,
        project_id=project_id,
        align_tree_id=align_tree_id,
        actor=context.actor,
        event_type="snapshot.deleted",
        target_type="snapshot",
        target_id=snapshot_id,
        summary=f"Deleted snapshot {name}",
        details={"values": {"name": name}},
    )
    db.commit()
