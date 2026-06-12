from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


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
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    project: Mapped[Project] = relationship(back_populates="layers")
    layout: Mapped[GraphLayout | None] = relationship(back_populates="layer", cascade="all, delete-orphan")
    style: Mapped[ShapeStyle | None] = relationship(back_populates="layer", cascade="all, delete-orphan")


class LayerRelation(Base, TimestampMixin):
    __tablename__ = "layer_relations"
    __table_args__ = (
        UniqueConstraint("project_id", "parent_layer_id", "child_layer_id", name="uq_relations_parent_child"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    parent_layer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("layers.id", ondelete="CASCADE"), index=True)
    child_layer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("layers.id", ondelete="CASCADE"), index=True)
    relation_type: Mapped[str] = mapped_column(String(80), default="parent_child")
    source_port: Mapped[str] = mapped_column(String(20), default="right")
    target_port: Mapped[str] = mapped_column(String(20), default="left")

    project: Mapped[Project] = relationship(back_populates="relations")
    parent_layer: Mapped[Layer] = relationship(foreign_keys=[parent_layer_id])
    child_layer: Mapped[Layer] = relationship(foreign_keys=[child_layer_id])


class GraphLayout(Base, TimestampMixin):
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


class ShapeStyle(Base, TimestampMixin):
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


class TextBox(Base, TimestampMixin):
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


class ChangeHistory(Base, TimestampMixin):
    __tablename__ = "change_history"

    id: Mapped[uuid.UUID] = uuid_pk()
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
