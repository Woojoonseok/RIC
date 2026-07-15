from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    layers: Mapped[list[Layer]] = relationship(back_populates="project", cascade="all, delete-orphan")
    relations: Mapped[list[LayerRelation]] = relationship(back_populates="project", cascade="all, delete-orphan")
    layouts: Mapped[list[GraphLayout]] = relationship(back_populates="project", cascade="all, delete-orphan")
    styles: Mapped[list[ShapeStyle]] = relationship(back_populates="project", cascade="all, delete-orphan")
    text_boxes: Mapped[list[TextBox]] = relationship(back_populates="project", cascade="all, delete-orphan")


class RelationStyle(Base):
    __tablename__ = "relation_styles"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    stroke_color: Mapped[str] = mapped_column(String(20), default="#111827")
    stroke_width: Mapped[int] = mapped_column(Integer, default=2)
    line_pattern: Mapped[str] = mapped_column(String(40), default="solid")
    marker_type: Mapped[str] = mapped_column(String(40), default="arrow")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class BoxPreset(Base):
    __tablename__ = "box_presets"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    fill_color: Mapped[str] = mapped_column(String(20), default="#dbeafe")
    stroke_color: Mapped[str] = mapped_column(String(20), default="#2563eb")
    text_color: Mapped[str] = mapped_column(String(20), default="#111827")
    font_size: Mapped[int] = mapped_column(Integer, default=16)
    width: Mapped[float] = mapped_column(Float, default=180)
    height: Mapped[float] = mapped_column(Float, default=72)
    stroke_width: Mapped[int] = mapped_column(Integer, default=2)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class KeyLayoutType(Base):
    __tablename__ = "key_layout_types"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    scribe_lane_rows: Mapped[int | None] = mapped_column(Integer)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    priorities: Mapped[list[LayerMasterPriority]] = relationship(
        back_populates="key_layout_type", cascade="all, delete-orphan"
    )


class KeyDrawingType(Base):
    __tablename__ = "key_drawing_types"

    id: Mapped[uuid.UUID] = uuid_pk()
    symbol: Mapped[str | None] = mapped_column(String(80))
    trench_mesa: Mapped[str | None] = mapped_column(String(80))
    key_shape: Mapped[str | None] = mapped_column(String(120))
    ri_notation: Mapped[str | None] = mapped_column(String(120))
    drawing_guide: Mapped[str | None] = mapped_column(String(200))
    gds_path: Mapped[str | None] = mapped_column(String(200))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class KeyShape(Base):
    __tablename__ = "key_shapes"

    id: Mapped[uuid.UUID] = uuid_pk()
    key_shape: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    drawing_guide: Mapped[str | None] = mapped_column(String(200))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class LayerMaster(Base):
    __tablename__ = "layer_masters"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    layer_number: Mapped[str | None] = mapped_column(String(40))
    mask_main_fld: Mapped[str | None] = mapped_column(String(40))
    mask_sl_fld: Mapped[str | None] = mapped_column(String(40))
    pr_wf: Mapped[str | None] = mapped_column(String(40))
    dev_wf: Mapped[str | None] = mapped_column(String(40))
    pr_type: Mapped[str | None] = mapped_column(String(40))
    light_source: Mapped[str | None] = mapped_column(String(40))
    pr_open_close: Mapped[str | None] = mapped_column(String(40))
    validation_rule: Mapped[str | None] = mapped_column(Text)
    comment: Mapped[str | None] = mapped_column(Text)
    priority_rows: Mapped[list[LayerMasterPriority]] = relationship(
        back_populates="layer_master", cascade="all, delete-orphan"
    )


class LayerMasterPriority(Base):
    __tablename__ = "layer_master_priorities"
    __table_args__ = (
        UniqueConstraint("layer_master_id", "key_layout_type_id", name="uq_master_layout_priority"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    layer_master_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("layer_masters.id", ondelete="CASCADE"), index=True
    )
    key_layout_type_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("key_layout_types.id", ondelete="CASCADE"), index=True
    )
    value: Mapped[str | None] = mapped_column(String(40))
    layer_master: Mapped[LayerMaster] = relationship(back_populates="priority_rows")
    key_layout_type: Mapped[KeyLayoutType] = relationship(back_populates="priorities")


class Layer(Base, TimestampMixin):
    __tablename__ = "layers"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_layers_project_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    step: Mapped[str | None] = mapped_column(String(120))
    layer_property: Mapped[str | None] = mapped_column(String(160))
    align: Mapped[str | None] = mapped_column(String(160))
    align_side: Mapped[str | None] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(Text)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    box_preset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("box_presets.id", ondelete="SET NULL"), index=True
    )
    pending_group: Mapped[str | None] = mapped_column(String(80))

    project: Mapped[Project] = relationship(back_populates="layers")
    box_preset: Mapped[BoxPreset | None] = relationship()
    layout: Mapped[GraphLayout | None] = relationship(back_populates="layer", cascade="all, delete-orphan")
    style: Mapped[ShapeStyle | None] = relationship(back_populates="layer", cascade="all, delete-orphan")


class LayerRelation(Base, TimestampMixin):
    __tablename__ = "layer_relations"
    __table_args__ = (
        UniqueConstraint(
            "project_id", "parent_layer_id", "child_layer_id", "instance", name="uq_relations_parent_child_instance"
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    parent_layer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("layers.id", ondelete="CASCADE"), nullable=True, index=True
    )
    child_layer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("layers.id", ondelete="CASCADE"), nullable=True, index=True
    )
    relation_type: Mapped[str] = mapped_column(String(80), default="parent_child")
    instance: Mapped[str | None] = mapped_column(String(120))
    relation_style_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("relation_styles.id", ondelete="SET NULL"), index=True
    )
    source_port: Mapped[str] = mapped_column(String(20), default="right")
    target_port: Mapped[str] = mapped_column(String(20), default="left")
    same_group: Mapped[str | None] = mapped_column(String(80))
    attached_relation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("layer_relations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    waypoints: Mapped[list[dict[str, float]]] = mapped_column(JSON, default=list)

    project: Mapped[Project] = relationship(back_populates="relations")
    parent_layer: Mapped[Layer | None] = relationship(foreign_keys=[parent_layer_id])
    child_layer: Mapped[Layer | None] = relationship(foreign_keys=[child_layer_id])
    relation_style: Mapped[RelationStyle | None] = relationship(foreign_keys=[relation_style_id])


class GraphLayout(Base):
    __tablename__ = "graph_layouts"
    __table_args__ = (UniqueConstraint("project_id", "layer_id", name="uq_layouts_project_layer"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    layer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("layers.id", ondelete="CASCADE"), index=True)
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)
    width: Mapped[float] = mapped_column(Float, default=180)
    height: Mapped[float] = mapped_column(Float, default=72)
    z_index: Mapped[int] = mapped_column(Integer, default=0)

    project: Mapped[Project] = relationship(back_populates="layouts")
    layer: Mapped[Layer] = relationship(back_populates="layout")


class ShapeStyle(Base):
    __tablename__ = "shape_styles"
    __table_args__ = (UniqueConstraint("project_id", "layer_id", name="uq_styles_project_layer"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    layer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("layers.id", ondelete="CASCADE"), index=True)
    fill_color: Mapped[str] = mapped_column(String(20), default="#ffffff")
    stroke_color: Mapped[str] = mapped_column(String(20), default="#2563eb")
    text_color: Mapped[str] = mapped_column(String(20), default="#111827")
    font_size: Mapped[int] = mapped_column(Integer, default=14)
    stroke_width: Mapped[int] = mapped_column(Integer, default=2)

    project: Mapped[Project] = relationship(back_populates="styles")
    layer: Mapped[Layer] = relationship(back_populates="style")


class TextBox(Base):
    __tablename__ = "text_boxes"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text, default="Text")
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)
    width: Mapped[float] = mapped_column(Float, default=180)
    height: Mapped[float] = mapped_column(Float, default=44)
    text_color: Mapped[str] = mapped_column(String(20), default="#111827")
    font_size: Mapped[int] = mapped_column(Integer, default=16)
    background_color: Mapped[str] = mapped_column(String(20), default="#ffffff")
    border_color: Mapped[str] = mapped_column(String(20), default="#d1d5db")
    locked: Mapped[bool] = mapped_column(Boolean, default=False)

    project: Mapped[Project] = relationship(back_populates="text_boxes")
