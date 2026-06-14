from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from .. import models


DEFAULT_BOX_PRESETS = [
    {
        "name": "Default Blue",
        "fill_color": "#dbeafe",
        "stroke_color": "#2563eb",
        "text_color": "#111827",
        "font_size": 16,
        "width": 180,
        "height": 72,
        "stroke_width": 2,
        "is_default": True,
    },
    {
        "name": "Yellow Note",
        "fill_color": "#fef3c7",
        "stroke_color": "#d97706",
        "text_color": "#111827",
        "font_size": 16,
        "width": 180,
        "height": 72,
        "stroke_width": 2,
        "is_default": False,
    },
    {
        "name": "Red Warning",
        "fill_color": "#fee2e2",
        "stroke_color": "#dc2626",
        "text_color": "#111827",
        "font_size": 16,
        "width": 180,
        "height": 72,
        "stroke_width": 2,
        "is_default": False,
    },
    {
        "name": "Gray Block",
        "fill_color": "#e5e7eb",
        "stroke_color": "#6b7280",
        "text_color": "#111827",
        "font_size": 16,
        "width": 180,
        "height": 72,
        "stroke_width": 2,
        "is_default": False,
    },
]


def ensure_default_box_presets(db: Session, project_id: uuid.UUID) -> list[models.BoxPreset]:
    existing = (
        db.query(models.BoxPreset)
        .filter(models.BoxPreset.project_id == project_id)
        .order_by(models.BoxPreset.sort_order, models.BoxPreset.created_at)
        .all()
    )
    if existing:
        return existing

    for index, preset_data in enumerate(DEFAULT_BOX_PRESETS):
        db.add(models.BoxPreset(project_id=project_id, sort_order=index, **preset_data))
    db.flush()
    return (
        db.query(models.BoxPreset)
        .filter(models.BoxPreset.project_id == project_id)
        .order_by(models.BoxPreset.sort_order, models.BoxPreset.created_at)
        .all()
    )


def default_box_preset_id(db: Session, project_id: uuid.UUID) -> uuid.UUID | None:
    presets = ensure_default_box_presets(db, project_id)
    default = next((preset for preset in presets if preset.is_default), None)
    return (default or presets[0]).id if presets else None
