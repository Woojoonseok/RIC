from __future__ import annotations

from sqlalchemy.orm import Session

from .. import models


DEFAULT_RELATION_STYLES = [
    {
        "name": "Black Solid Arrow",
        "stroke_color": "#111827",
        "stroke_width": 2,
        "line_pattern": "solid",
        "marker_type": "arrow",
    },
    {
        "name": "Gray Solid Arrow",
        "stroke_color": "#6b7280",
        "stroke_width": 2,
        "line_pattern": "solid",
        "marker_type": "arrow",
    },
    {
        "name": "Red Solid Arrow",
        "stroke_color": "#dc2626",
        "stroke_width": 2,
        "line_pattern": "solid",
        "marker_type": "arrow",
    },
    {
        "name": "Blue Solid Arrow",
        "stroke_color": "#2563eb",
        "stroke_width": 2,
        "line_pattern": "solid",
        "marker_type": "arrow",
    },
    {
        "name": "Solid Arrow",
        "stroke_color": "#334155",
        "stroke_width": 2,
        "line_pattern": "solid",
        "marker_type": "arrow",
    },
    {
        "name": "Reference Arrow",
        "stroke_color": "#7c3aed",
        "stroke_width": 2,
        "line_pattern": "reference",
        "marker_type": "arrow",
    },
]


def ensure_default_relation_styles(db: Session) -> list[models.RelationStyle]:
    existing = (
        db.query(models.RelationStyle)
        .order_by(models.RelationStyle.sort_order, models.RelationStyle.created_at)
        .all()
    )
    if existing:
        return existing

    created = []
    for index, style_data in enumerate(DEFAULT_RELATION_STYLES):
        style = models.RelationStyle(sort_order=index, **style_data)
        db.add(style)
        created.append(style)
    if created:
        db.flush()
        existing.extend(created)
    return (
        db.query(models.RelationStyle)
        .order_by(models.RelationStyle.sort_order, models.RelationStyle.created_at)
        .all()
    )


def default_relation_style_id(db: Session):
    styles = ensure_default_relation_styles(db)
    return styles[0].id if styles else None
