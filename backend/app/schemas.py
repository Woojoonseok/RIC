from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None


class ProjectRead(OrmModel):
    id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class LayerBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    step: str | None = None
    layer_property: str | None = None
    align: str | None = None
    align_side: str | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)


class LayerCreate(LayerBase):
    x: float = 80
    y: float = 80
    width: float = 180
    height: float = 72


class LayerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    step: str | None = None
    layer_property: str | None = None
    align: str | None = None
    align_side: str | None = None
    metadata_json: dict[str, Any] | None = None


class LayerRead(OrmModel, LayerBase):
    id: uuid.UUID
    project_id: uuid.UUID


class LayoutUpdate(BaseModel):
    x: float | None = None
    y: float | None = None
    width: float | None = Field(default=None, ge=60)
    height: float | None = Field(default=None, ge=36)
    z_index: int | None = None


class LayoutRead(OrmModel):
    id: uuid.UUID
    project_id: uuid.UUID
    layer_id: uuid.UUID
    x: float
    y: float
    width: float
    height: float
    z_index: int


class StyleUpdate(BaseModel):
    fill_color: str | None = None
    stroke_color: str | None = None
    text_color: str | None = None
    font_size: int | None = Field(default=None, ge=8, le=72)
    stroke_width: int | None = Field(default=None, ge=1, le=12)


class StyleRead(OrmModel):
    id: uuid.UUID
    project_id: uuid.UUID
    layer_id: uuid.UUID
    fill_color: str
    stroke_color: str
    text_color: str
    font_size: int
    stroke_width: int


class RelationBase(BaseModel):
    parent_layer_id: uuid.UUID
    child_layer_id: uuid.UUID
    relation_type: str = "parent_child"
    source_port: Literal["top", "right", "bottom", "left"] = "right"
    target_port: Literal["top", "right", "bottom", "left"] = "left"


class RelationCreate(RelationBase):
    pass


class RelationUpdate(BaseModel):
    parent_layer_id: uuid.UUID | None = None
    child_layer_id: uuid.UUID | None = None
    relation_type: str | None = None
    source_port: Literal["top", "right", "bottom", "left"] | None = None
    target_port: Literal["top", "right", "bottom", "left"] | None = None


class RelationRead(OrmModel, RelationBase):
    id: uuid.UUID
    project_id: uuid.UUID


class TextBoxBase(BaseModel):
    text: str = "Text"
    x: float = 120
    y: float = 120
    width: float = 180
    height: float = 44
    text_color: str = "#111827"
    font_size: int = Field(default=16, ge=8, le=96)
    background_color: str = "#ffffff"
    border_color: str = "#d1d5db"
    locked: bool = False


class TextBoxCreate(TextBoxBase):
    pass


class TextBoxUpdate(BaseModel):
    text: str | None = None
    x: float | None = None
    y: float | None = None
    width: float | None = Field(default=None, ge=40)
    height: float | None = Field(default=None, ge=24)
    text_color: str | None = None
    font_size: int | None = Field(default=None, ge=8, le=96)
    background_color: str | None = None
    border_color: str | None = None
    locked: bool | None = None


class TextBoxRead(OrmModel, TextBoxBase):
    id: uuid.UUID
    project_id: uuid.UUID


class GraphRead(BaseModel):
    project: ProjectRead
    layers: list[LayerRead]
    layouts: list[LayoutRead]
    styles: list[StyleRead]
    relations: list[RelationRead]
    text_boxes: list[TextBoxRead]
    validation: "ValidationReport"


class GraphUpdate(BaseModel):
    layers: list[LayerRead] | None = None
    layouts: list[LayoutRead] | None = None
    styles: list[StyleRead] | None = None
    relations: list[RelationRead] | None = None
    text_boxes: list[TextBoxRead] | None = None


class ValidationIssue(BaseModel):
    code: str
    severity: Literal["error", "warning"]
    message: str
    relation_id: uuid.UUID | None = None
    layer_id: uuid.UUID | None = None


class ValidationReport(BaseModel):
    ok: bool
    issues: list[ValidationIssue]


GraphRead.model_rebuild()
