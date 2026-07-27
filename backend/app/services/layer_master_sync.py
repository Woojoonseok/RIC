from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from .. import crud, models, schemas


def _snapshot(master: models.LayerMaster) -> dict[str, Any]:
    return {
        "id": str(master.id),
        "name": master.name,
        "layer_number": master.layer_number,
        "mask_main_fld": master.mask_main_fld,
        "mask_sl_fld": master.mask_sl_fld,
        "pr_wf": master.pr_wf,
        "dev_wf": master.dev_wf,
        "pr_type": master.pr_type,
        "light_source": master.light_source,
        "pr_open_close": master.pr_open_close,
        "group": master.group,
        "validation_rule": master.validation_rule,
        "comment": master.comment,
        "priorities": {str(row.key_layout_type_id): row.value for row in master.priorities},
    }


def _layer_group(db: Session, layer: models.Layer) -> str | None:
    if layer.pending_group:
        return layer.pending_group
    relation = (
        db.query(models.LayerRelation)
        .filter(
            models.LayerRelation.project_id == layer.project_id,
            models.LayerRelation.align_tree_id == layer.align_tree_id,
            models.LayerRelation.same_group.is_not(None),
            models.LayerRelation.same_group != "",
            (models.LayerRelation.parent_layer_id == layer.id)
            | (models.LayerRelation.child_layer_id == layer.id),
        )
        .first()
    )
    return relation.same_group if relation else None


def _apply_master_to_layer(db: Session, master: models.LayerMaster, layer: models.Layer) -> None:
    metadata = dict(layer.metadata_json or {})
    metadata["layer_master_id"] = str(master.id)
    metadata["layer_master"] = _snapshot(master)
    layer.layer_master_id = master.id
    layer.name = master.name
    layer.step = master.layer_number
    layer.metadata_json = metadata
    if master.light_source:
        preset = (
            db.query(models.BoxPreset)
            .filter(
                models.BoxPreset.project_id == master.project_id,
                models.BoxPreset.name == master.light_source,
            )
            .one_or_none()
        )
        if preset is not None:
            layer.box_preset_id = preset.id


def _ensure_tree_layer(
    db: Session,
    master: models.LayerMaster,
    tree: models.AlignTree,
    position: int,
) -> models.Layer:
    layer = (
        db.query(models.Layer)
        .filter(
            models.Layer.project_id == master.project_id,
            models.Layer.align_tree_id == tree.id,
            models.Layer.layer_master_id == master.id,
        )
        .one_or_none()
    )
    if layer is None:
        layer = (
            db.query(models.Layer)
            .filter(
                models.Layer.project_id == master.project_id,
                models.Layer.align_tree_id == tree.id,
                models.Layer.layer_master_id.is_(None),
                models.Layer.name == master.name,
            )
            .one_or_none()
        )
    if layer is None:
        layer = crud.create_layer(
            db,
            master.project_id,
            tree.id,
            schemas.LayerCreate(
                name=master.name,
                step=master.layer_number,
                metadata_json={"layer_master_id": str(master.id)},
                x=100 + (position % 6) * 220,
                y=100 + (position // 6) * 130,
            ),
        )
    _apply_master_to_layer(db, master, layer)
    return layer


def _adopt_unlinked_layers(db: Session, project_id: uuid.UUID) -> None:
    masters = {
        row.name.casefold(): row
        for row in db.query(models.LayerMaster).filter(models.LayerMaster.project_id == project_id).all()
    }
    layers = (
        db.query(models.Layer)
        .filter(models.Layer.project_id == project_id, models.Layer.layer_master_id.is_(None))
        .order_by(models.Layer.created_at, models.Layer.id)
        .all()
    )
    for layer in layers:
        master = masters.get(layer.name.casefold())
        if master is None:
            master = models.LayerMaster(
                project_id=project_id,
                name=layer.name,
                layer_number=layer.step,
                group=_layer_group(db, layer),
            )
            db.add(master)
            db.flush()
            masters[master.name.casefold()] = master
        _apply_master_to_layer(db, master, layer)


def ensure_project_layer_sync(db: Session, project_id: uuid.UUID) -> None:
    _adopt_unlinked_layers(db, project_id)
    trees = (
        db.query(models.AlignTree)
        .filter(models.AlignTree.project_id == project_id, models.AlignTree.deleted_at.is_(None))
        .order_by(models.AlignTree.created_at, models.AlignTree.id)
        .all()
    )
    masters = (
        db.query(models.LayerMaster)
        .filter(models.LayerMaster.project_id == project_id)
        .order_by(models.LayerMaster.created_at, models.LayerMaster.id)
        .all()
    )
    for tree in trees:
        tree_layers: list[tuple[models.LayerMaster, models.Layer]] = []
        for index, master in enumerate(masters):
            tree_layers.append((master, _ensure_tree_layer(db, master, tree, index)))
        db.flush()
        # Local import avoids a router/service import cycle. Group reconciliation
        # remains centralized in the graph implementation.
        from ..routers.graph import _sync_layer_group

        for master, layer in tree_layers:
            _sync_layer_group(db, project_id, tree.id, layer.id, master.group)
    db.flush()


def sync_layer_master(db: Session, master: models.LayerMaster) -> None:
    ensure_project_layer_sync(db, master.project_id)


def delete_layer_master_layers(db: Session, master: models.LayerMaster) -> None:
    layers = (
        db.query(models.Layer)
        .filter(models.Layer.project_id == master.project_id, models.Layer.layer_master_id == master.id)
        .all()
    )
    for layer in layers:
        if layer.align_tree_id is not None:
            crud.delete_layer_with_relations(db, master.project_id, layer.align_tree_id, layer.id)
    db.flush()
    if master.group:
        from ..routers.graph import _sync_layer_group

        remaining_masters = (
            db.query(models.LayerMaster)
            .filter(
                models.LayerMaster.project_id == master.project_id,
                models.LayerMaster.id != master.id,
                models.LayerMaster.group == master.group,
            )
            .all()
        )
        for remaining in remaining_masters:
            remaining_layers = (
                db.query(models.Layer)
                .filter(
                    models.Layer.project_id == master.project_id,
                    models.Layer.layer_master_id == remaining.id,
                )
                .all()
            )
            for layer in remaining_layers:
                if layer.align_tree_id is not None:
                    _sync_layer_group(
                        db,
                        master.project_id,
                        layer.align_tree_id,
                        layer.id,
                        remaining.group,
                    )
    db.flush()
