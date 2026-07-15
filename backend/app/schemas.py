from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


PortName = Literal["top", "right", "bottom", "left"]


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
    description: str | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    box_preset_id: uuid.UUID | None = None
    pending_group: str | None = None


class LayerCreate(LayerBase):
    x: float = 80
    y: float = 80
    width: float = Field(default=180, ge=60)
    height: float = Field(default=72, ge=36)


class LayerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    step: str | None = None
    layer_property: str | None = None
    align: str | None = None
    align_side: str | None = None
    description: str | None = None
    metadata_json: dict[str, Any] | None = None
    box_preset_id: uuid.UUID | None = None
    pending_group: str | None = None


class LayerMergeRequest(BaseModel):
    layer_ids: list[uuid.UUID] = Field(min_length=2)
    name: str | None = Field(default=None, min_length=1, max_length=160)


class LayerSplitRequest(BaseModel):
    orientation: Literal["vertical", "horizontal"] = "vertical"


class LayerGroupUpdate(BaseModel):
    group: str | None = Field(default=None, max_length=80)


class LayerRead(OrmModel, LayerBase):
    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class LayoutUpdate(BaseModel):
    x: float | None = None
    y: float | None = None
    width: float | None = Field(default=None, ge=60)
    height: float | None = Field(default=None, ge=36)
    z_index: int | None = None


class LayoutBatchUpdate(LayoutUpdate):
    layer_id: uuid.UUID


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
    fill_color: str | None = Field(default=None, max_length=20)
    stroke_color: str | None = Field(default=None, max_length=20)
    text_color: str | None = Field(default=None, max_length=20)
    font_size: int | None = Field(default=None, ge=8, le=72)
    stroke_width: int | None = Field(default=None, ge=1, le=12)


class StyleBatchUpdate(StyleUpdate):
    layer_id: uuid.UUID


class StyleRead(OrmModel):
    id: uuid.UUID
    project_id: uuid.UUID
    layer_id: uuid.UUID
    fill_color: str
    stroke_color: str
    text_color: str
    font_size: int
    stroke_width: int


class RelationStyleBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    stroke_color: str = Field(default="#111827", max_length=20)
    stroke_width: int = Field(default=2, ge=1, le=12)
    line_pattern: Literal["solid", "dashed", "dotted", "reference"] = "solid"
    marker_type: Literal["arrow", "none"] = "arrow"
    sort_order: int = 0


class RelationStyleCreate(RelationStyleBase):
    pass


class RelationStyleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    stroke_color: str | None = Field(default=None, max_length=20)
    stroke_width: int | None = Field(default=None, ge=1, le=12)
    line_pattern: Literal["solid", "dashed", "dotted", "reference"] | None = None
    marker_type: Literal["arrow", "none"] | None = None
    sort_order: int | None = None


class RelationStyleRead(OrmModel, RelationStyleBase):
    id: uuid.UUID


class BoxPresetBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    fill_color: str = Field(default="#dbeafe", max_length=20)
    stroke_color: str = Field(default="#2563eb", max_length=20)
    text_color: str = Field(default="#111827", max_length=20)
    font_size: int = Field(default=16, ge=8, le=72)
    width: float = Field(default=180, ge=60)
    height: float = Field(default=72, ge=36)
    stroke_width: int = Field(default=2, ge=1, le=12)
    is_default: bool = False
    sort_order: int = 0


class BoxPresetCreate(BoxPresetBase):
    pass


class BoxPresetUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    fill_color: str | None = Field(default=None, max_length=20)
    stroke_color: str | None = Field(default=None, max_length=20)
    text_color: str | None = Field(default=None, max_length=20)
    font_size: int | None = Field(default=None, ge=8, le=72)
    width: float | None = Field(default=None, ge=60)
    height: float | None = Field(default=None, ge=36)
    stroke_width: int | None = Field(default=None, ge=1, le=12)
    is_default: bool | None = None
    sort_order: int | None = None


class BoxPresetRead(OrmModel, BoxPresetBase):
    id: uuid.UUID


class KeyLayoutTypeBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scribe_lane_rows: int | None = Field(default=None, ge=0)
    sort_order: int = 0


class KeyLayoutTypeCreate(KeyLayoutTypeBase):
    pass


class KeyLayoutTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    scribe_lane_rows: int | None = Field(default=None, ge=0)
    sort_order: int | None = None


class KeyLayoutTypeRead(OrmModel, KeyLayoutTypeBase):
    id: uuid.UUID


class KeyDrawingTypeBase(BaseModel):
    symbol: str | None = Field(default=None, max_length=80)
    trench_mesa: str | None = Field(default=None, max_length=80)
    key_shape: str | None = Field(default=None, max_length=120)
    ri_notation: str | None = Field(default=None, max_length=120)
    drawing_guide: str | None = Field(default=None, max_length=200)
    gds_path: str | None = Field(default=None, max_length=200)
    sort_order: int = 0


class KeyDrawingTypeCreate(KeyDrawingTypeBase):
    pass


class KeyDrawingTypeUpdate(BaseModel):
    symbol: str | None = Field(default=None, max_length=80)
    trench_mesa: str | None = Field(default=None, max_length=80)
    key_shape: str | None = Field(default=None, max_length=120)
    ri_notation: str | None = Field(default=None, max_length=120)
    drawing_guide: str | None = Field(default=None, max_length=200)
    gds_path: str | None = Field(default=None, max_length=200)
    sort_order: int | None = None


class KeyDrawingTypeRead(OrmModel, KeyDrawingTypeBase):
    id: uuid.UUID


class KeyShapeBase(BaseModel):
    key_shape: str = Field(min_length=1, max_length=120)
    drawing_guide: str | None = Field(default=None, max_length=200)
    sort_order: int = 0


class KeyShapeCreate(KeyShapeBase):
    pass


class KeyShapeUpdate(BaseModel):
    key_shape: str | None = Field(default=None, min_length=1, max_length=120)
    drawing_guide: str | None = Field(default=None, max_length=200)
    sort_order: int | None = None


class KeyShapeRead(OrmModel, KeyShapeBase):
    id: uuid.UUID


class LayerMasterBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    layer_number: str | None = Field(default=None, max_length=40)
    mask_main_fld: str | None = Field(default=None, max_length=40)
    mask_sl_fld: str | None = Field(default=None, max_length=40)
    pr_wf: str | None = Field(default=None, max_length=40)
    dev_wf: str | None = Field(default=None, max_length=40)
    pr_type: str | None = Field(default=None, max_length=40)
    light_source: str | None = Field(default=None, max_length=40)
    pr_open_close: str | None = Field(default=None, max_length=40)
    validation_rule: str | None = None
    comment: str | None = None
    priorities: dict[str, str | None] = Field(default_factory=dict)


class LayerMasterCreate(LayerMasterBase):
    pass


class LayerMasterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    layer_number: str | None = Field(default=None, max_length=40)
    mask_main_fld: str | None = Field(default=None, max_length=40)
    mask_sl_fld: str | None = Field(default=None, max_length=40)
    pr_wf: str | None = Field(default=None, max_length=40)
    dev_wf: str | None = Field(default=None, max_length=40)
    pr_type: str | None = Field(default=None, max_length=40)
    light_source: str | None = Field(default=None, max_length=40)
    pr_open_close: str | None = Field(default=None, max_length=40)
    validation_rule: str | None = None
    comment: str | None = None
    priorities: dict[str, str | None] | None = None


class LayerMasterRead(LayerMasterBase):
    id: uuid.UUID


class RelationBase(BaseModel):
    parent_layer_id: uuid.UUID | None = None
    child_layer_id: uuid.UUID | None = None
    relation_type: str = Field(default="parent_child", max_length=80)
    instance: str | None = Field(default=None, max_length=120)
    relation_style_id: uuid.UUID | None = None
    source_port: PortName = "right"
    target_port: PortName = "left"
    same_group: str | None = Field(default=None, max_length=80)
    attached_relation_id: uuid.UUID | None = None
    waypoints: list[dict[str, float]] = Field(default_factory=list)


class RelationCreate(RelationBase):
    pass


class RelationUpdate(BaseModel):
    parent_layer_id: uuid.UUID | None = None
    child_layer_id: uuid.UUID | None = None
    relation_type: str | None = Field(default=None, max_length=80)
    instance: str | None = Field(default=None, max_length=120)
    relation_style_id: uuid.UUID | None = None
    source_port: PortName | None = None
    target_port: PortName | None = None
    same_group: str | None = Field(default=None, max_length=80)
    attached_relation_id: uuid.UUID | None = None
    waypoints: list[dict[str, float]] | None = None


class RelationRead(OrmModel, RelationBase):
    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class TextBoxBase(BaseModel):
    text: str = "Text"
    x: float = 120
    y: float = 120
    width: float = Field(default=180, ge=40)
    height: float = Field(default=44, ge=24)
    text_color: str = Field(default="#111827", max_length=20)
    font_size: int = Field(default=16, ge=8, le=96)
    background_color: str = Field(default="#ffffff", max_length=20)
    border_color: str = Field(default="#d1d5db", max_length=20)
    locked: bool = False


class TextBoxCreate(TextBoxBase):
    pass


class TextBoxUpdate(BaseModel):
    text: str | None = None
    x: float | None = None
    y: float | None = None
    width: float | None = Field(default=None, ge=40)
    height: float | None = Field(default=None, ge=24)
    text_color: str | None = Field(default=None, max_length=20)
    font_size: int | None = Field(default=None, ge=8, le=96)
    background_color: str | None = Field(default=None, max_length=20)
    border_color: str | None = Field(default=None, max_length=20)
    locked: bool | None = None


class TextBoxBatchUpdate(TextBoxUpdate):
    id: uuid.UUID


class TextBoxRead(OrmModel, TextBoxBase):
    id: uuid.UUID
    project_id: uuid.UUID


class ValidationIssue(BaseModel):
    code: str
    severity: Literal["error", "warning"]
    message: str
    relation_id: uuid.UUID | None = None
    layer_id: uuid.UUID | None = None


class ValidationReport(BaseModel):
    ok: bool
    issues: list[ValidationIssue]


class GraphRead(BaseModel):
    project: ProjectRead
    layers: list[LayerRead]
    layouts: list[LayoutRead]
    styles: list[StyleRead]
    box_presets: list[BoxPresetRead]
    relation_styles: list[RelationStyleRead]
    relations: list[RelationRead]
    text_boxes: list[TextBoxRead]
    validation: ValidationReport


class GraphBatchUpdate(BaseModel):
    layouts: list[LayoutBatchUpdate] = Field(default_factory=list)
    styles: list[StyleBatchUpdate] = Field(default_factory=list)
    text_boxes: list[TextBoxBatchUpdate] = Field(default_factory=list)


class GraphRestore(BaseModel):
    layers: list[LayerRead] = Field(default_factory=list)
    layouts: list[LayoutRead] = Field(default_factory=list)
    styles: list[StyleRead] = Field(default_factory=list)
    relations: list[RelationRead] = Field(default_factory=list)
    text_boxes: list[TextBoxRead] = Field(default_factory=list)
