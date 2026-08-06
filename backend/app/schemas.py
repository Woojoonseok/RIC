from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


FinalTableText = Annotated[str, Field(max_length=160)]
FinalTableLayerTextMap = dict[str, FinalTableText]
FinalTableCellMap = dict[str, FinalTableLayerTextMap]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None


class ProjectBranchCreate(ProjectCreate):
    pass


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None


class ProjectRead(OrmModel):
    id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
    revision: int = 0
    access_role: Literal["owner", "admin", "editor", "viewer"] | None = None
    is_locked: bool = False
    locked_by_me: bool = False
    lock_expires_at: datetime | None = None
    lock_holder_display_name: str | None = None


class ActorSummary(BaseModel):
    id: uuid.UUID
    display_name: str


class ProjectPublicRead(ProjectRead):
    creator: ActorSummary | None = None
    creator_display_name: str
    my_role: Literal["owner", "admin", "editor", "viewer"] | None = None
    access_request_status: Literal["pending", "approved", "rejected", "cancelled"] | None = None
    align_tree_count: int = 0
    member_count: int = 0
    is_public: bool = True
    is_legacy_unclaimed: bool = False


class ActorUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


class ProjectMemberCreate(BaseModel):
    actor_id: uuid.UUID
    role: Literal["admin", "editor", "viewer"]


class ProjectMemberUpdate(BaseModel):
    role: Literal["admin", "editor", "viewer"]


class ProjectMemberRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    actor: ActorSummary
    role: Literal["owner", "admin", "editor", "viewer"]
    added_by_actor_id: uuid.UUID | None = None
    created_at: datetime


class AccessRequestCreate(BaseModel):
    requested_role: Literal["viewer", "editor"] = "viewer"
    message: str | None = Field(default=None, max_length=1000)


class AccessRequestDecision(BaseModel):
    status: Literal["approved", "rejected"]
    role: Literal["admin", "editor", "viewer"] | None = None
    decision_note: str | None = Field(default=None, max_length=1000)


class AccessRequestRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    requester: ActorSummary
    requested_role: Literal["viewer", "editor"]
    message: str | None
    status: Literal["pending", "approved", "rejected", "cancelled"]
    reviewed_by: ActorSummary | None = None
    reviewed_at: datetime | None = None
    decision_note: str | None = None
    created_at: datetime


class AuditEventRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    align_tree_id: uuid.UUID | None = None
    actor: ActorSummary | None = None
    actor_label_snapshot: str
    event_type: str
    target_type: str
    target_id: uuid.UUID | None = None
    summary: str
    details_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AlignTreeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None
    process_name: str | None = Field(default=None, max_length=160)
    gds_name: str | None = Field(default=None, max_length=160)
    layer_process_names: FinalTableLayerTextMap = Field(default_factory=dict)
    layer_gds_names: FinalTableLayerTextMap = Field(default_factory=dict)
    final_table_cells: FinalTableCellMap = Field(default_factory=dict)


class AlignTreeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    process_name: str | None = Field(default=None, max_length=160)
    gds_name: str | None = Field(default=None, max_length=160)
    layer_process_names: FinalTableLayerTextMap = Field(default_factory=dict)
    layer_gds_names: FinalTableLayerTextMap = Field(default_factory=dict)
    final_table_cells: FinalTableCellMap = Field(default_factory=dict)


class AlignTreeRead(OrmModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: str | None
    process_name: str | None
    gds_name: str | None
    layer_process_names: FinalTableLayerTextMap = Field(default_factory=dict)
    layer_gds_names: FinalTableLayerTextMap = Field(default_factory=dict)
    final_table_cells: FinalTableCellMap = Field(default_factory=dict)
    revision: int
    is_default: bool
    workflow_status: Literal["draft", "in_review", "approved", "published"] = "draft"
    workflow_note: str | None = None
    review_requested_by_actor_id: uuid.UUID | None = None
    review_requested_by_label: str | None = None
    review_requested_at: datetime | None = None
    reviewed_by_actor_id: uuid.UUID | None = None
    reviewed_by_label: str | None = None
    reviewed_at: datetime | None = None
    approved_snapshot_id: uuid.UUID | None = None
    published_snapshot_id: uuid.UUID | None = None
    published_by_actor_id: uuid.UUID | None = None
    published_by_label: str | None = None
    published_at: datetime | None = None
    created_by_actor_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class WorkflowTransitionRequest(BaseModel):
    note: str = Field(min_length=1, max_length=1000)


class ActorRead(OrmModel):
    id: uuid.UUID
    display_name: str
    identity_provider: Literal["anonymous"] = "anonymous"


class ShareLinkCreate(BaseModel):
    permission: Literal["viewer", "editor"]
    expires_at: datetime | None = None


class ShareLinkRead(OrmModel):
    id: uuid.UUID
    project_id: uuid.UUID
    permission: Literal["viewer", "editor"]
    created_at: datetime
    expires_at: datetime | None = None
    revoked_at: datetime | None = None


class ShareLinkCreated(ShareLinkRead):
    token: str
    share_path: str


class ShareClaim(BaseModel):
    token: str = Field(min_length=20, max_length=512)


class LeaseAcquire(BaseModel):
    client_instance_id: str = Field(min_length=1, max_length=120)
    force: bool = False


class LeaseHeartbeat(BaseModel):
    client_instance_id: str = Field(min_length=1, max_length=120)


class LeaseRead(BaseModel):
    lease_token: str
    expires_at: datetime
    revision: int


class LayerBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    step: str | None = None
    layer_property: str | None = None
    align: str | None = None
    align_side: str | None = None
    description: str | None = None
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    box_preset_id: uuid.UUID | None = None


class LayerCreate(LayerBase):
    layer_master_id: uuid.UUID | None = None
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
    description: str | None = None
    metadata_json: dict[str, Any] | None = None
    box_preset_id: uuid.UUID | None = None


class LayerMergeRequest(BaseModel):
    layer_ids: list[uuid.UUID] = Field(min_length=2)
    name: str | None = Field(default=None, min_length=1, max_length=160)


class LayerSplitRequest(BaseModel):
    orientation: Literal["vertical", "horizontal"] = "vertical"


class LayerGroupUpdate(BaseModel):
    # Empty/None removes the layer from any group it's currently in.
    group: str | None = Field(default=None, max_length=80)


class LayerRead(OrmModel, LayerBase):
    id: uuid.UUID
    project_id: uuid.UUID
    align_tree_id: uuid.UUID | None = None
    layer_master_id: uuid.UUID | None = None
    # Only ever set/cleared via PATCH .../layers/{id}/group — see _sync_layer_group.
    pending_group: str | None = None


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
    align_tree_id: uuid.UUID | None = None
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


class StyleBatchUpdate(StyleUpdate):
    layer_id: uuid.UUID


class LayerPresetBatchUpdate(BaseModel):
    layer_id: uuid.UUID
    box_preset_id: uuid.UUID


class StyleRead(OrmModel):
    id: uuid.UUID
    project_id: uuid.UUID
    align_tree_id: uuid.UUID | None = None
    layer_id: uuid.UUID
    fill_color: str
    stroke_color: str
    text_color: str
    font_size: int
    stroke_width: int


class BoxPresetBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    fill_color: str = "#dbeafe"
    stroke_color: str = "#2563eb"
    text_color: str = "#111827"
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
    fill_color: str | None = None
    stroke_color: str | None = None
    text_color: str | None = None
    font_size: int | None = Field(default=None, ge=8, le=72)
    width: float | None = Field(default=None, ge=60)
    height: float | None = Field(default=None, ge=36)
    stroke_width: int | None = Field(default=None, ge=1, le=12)
    is_default: bool | None = None
    sort_order: int | None = None


class BoxPresetRead(OrmModel, BoxPresetBase):
    id: uuid.UUID
    project_id: uuid.UUID | None = None


class RelationStyleBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    stroke_color: str = "#111827"
    stroke_width: int = Field(default=2, ge=1, le=12)
    line_pattern: Literal["solid", "dashed", "dotted", "reference"] = "solid"
    marker_type: Literal["arrow", "none"] = "arrow"
    sort_order: int = 0


class RelationStyleCreate(RelationStyleBase):
    pass


class RelationStyleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    stroke_color: str | None = None
    stroke_width: int | None = Field(default=None, ge=1, le=12)
    line_pattern: Literal["solid", "dashed", "dotted", "reference"] | None = None
    marker_type: Literal["arrow", "none"] | None = None
    sort_order: int | None = None


class RelationStyleRead(OrmModel, RelationStyleBase):
    id: uuid.UUID
    project_id: uuid.UUID | None = None


class KeyLayoutTypeBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scribe_lane_rows: int | None = None
    sort_order: int = 0


class KeyLayoutTypeCreate(KeyLayoutTypeBase):
    pass


class KeyLayoutTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    scribe_lane_rows: int | None = None
    sort_order: int | None = None


class KeyLayoutTypeRead(OrmModel, KeyLayoutTypeBase):
    id: uuid.UUID
    project_id: uuid.UUID | None = None


class KeyDrawingTypeBase(BaseModel):
    symbol: str | None = None
    trench_mesa: str | None = None
    key_shape: str | None = None
    ri_notation: str | None = None
    drawing_guide: str | None = None
    gds_path: str | None = None
    sort_order: int = 0


class KeyDrawingTypeCreate(KeyDrawingTypeBase):
    pass


class KeyDrawingTypeUpdate(BaseModel):
    symbol: str | None = None
    trench_mesa: str | None = None
    key_shape: str | None = None
    ri_notation: str | None = None
    drawing_guide: str | None = None
    gds_path: str | None = None
    sort_order: int | None = None


class KeyDrawingTypeRead(OrmModel, KeyDrawingTypeBase):
    id: uuid.UUID
    project_id: uuid.UUID | None = None


class KeyShapeBase(BaseModel):
    key_shape: str = Field(min_length=1, max_length=120)
    drawing_guide: str | None = None
    sort_order: int = 0


class KeyShapeCreate(KeyShapeBase):
    pass


class KeyShapeUpdate(BaseModel):
    key_shape: str | None = Field(default=None, min_length=1, max_length=120)
    drawing_guide: str | None = None
    sort_order: int | None = None


class KeyShapeRead(OrmModel, KeyShapeBase):
    id: uuid.UUID
    project_id: uuid.UUID | None = None


class LayerMasterBase(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    layer_number: str | None = None
    mask_main_fld: str | None = None
    mask_sl_fld: str | None = None
    pr_wf: str | None = None
    dev_wf: str | None = None
    pr_type: str | None = None
    light_source: str | None = None
    pr_open_close: str | None = None
    group: str | None = Field(default=None, max_length=80)
    validation_rule: str | None = None
    comment: str | None = None


class LayerMasterCreate(LayerMasterBase):
    layer_number: str = Field(min_length=1, max_length=40)
    # key_layout_type_id -> value. Rows are seeded from every 기준정보 Key 배치
    # Type that exists at creation time; any type not mentioned here starts blank.
    priorities: dict[uuid.UUID, str | None] = Field(default_factory=dict)


class LayerMasterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    layer_number: str | None = None
    mask_main_fld: str | None = None
    mask_sl_fld: str | None = None
    pr_wf: str | None = None
    dev_wf: str | None = None
    pr_type: str | None = None
    light_source: str | None = None
    pr_open_close: str | None = None
    group: str | None = Field(default=None, max_length=80)
    validation_rule: str | None = None
    comment: str | None = None
    priorities: dict[uuid.UUID, str | None] | None = None


class LayerMasterRead(OrmModel, LayerMasterBase):
    id: uuid.UUID
    project_id: uuid.UUID | None = None
    priorities: dict[uuid.UUID, str | None] = Field(default_factory=dict)


class LayerMasterImportData(LayerMasterBase):
    name: str = Field(default="", max_length=160)
    layer_number: str = Field(default="", max_length=40)
    priorities: dict[uuid.UUID, str | None] = Field(default_factory=dict)


class LayerMasterImportRow(BaseModel):
    row_number: int = Field(ge=1)
    layer: LayerMasterImportData


class LayerMasterImportRequest(BaseModel):
    rows: list[LayerMasterImportRow] = Field(min_length=1, max_length=5000)


class LayerMasterImportIssue(BaseModel):
    row_number: int | None = None
    code: str
    message: str


class LayerMasterImportPreview(BaseModel):
    total_count: int
    create_count: int
    error_count: int
    issues: list[LayerMasterImportIssue] = Field(default_factory=list)


class LayerMasterImportCommitResult(BaseModel):
    created_count: int
    rows: list[LayerMasterRead] = Field(default_factory=list)


class RelationExtraCreate(BaseModel):
    layer_master_id: uuid.UUID
    key_drawing_type_id: uuid.UUID
    sort_order: int = Field(default=0, ge=0)


class RelationExtraRead(OrmModel, RelationExtraCreate):
    id: uuid.UUID
    project_id: uuid.UUID
    relation_id: uuid.UUID


class RelationBase(BaseModel):
    # Optional so a blank "Add Row" relation can be created before the user
    # has typed in a parent/child layer name.
    parent_endpoint_type: Literal["layer", "spare"] = "layer"
    child_endpoint_type: Literal["layer", "spare"] = "layer"
    parent_layer_id: uuid.UUID | None = None
    child_layer_id: uuid.UUID | None = None
    key_layout_type_id: uuid.UUID | None = None
    key_drawing_type_id: uuid.UUID | None = None
    relation_type: str = "parent_child"
    relation_style_id: uuid.UUID | None = None
    parent_drawing_type_id: uuid.UUID | None = None
    child_drawing_type_id: uuid.UUID | None = None
    comment: str | None = None
    key_priority: str | None = Field(default=None, max_length=120)
    priority_rule: str | None = None
    final_type: str | None = Field(default=None, max_length=160)
    key_purpose: str | None = Field(default=None, max_length=160)
    placement: str | None = Field(default=None, max_length=160)
    stack_type: str | None = Field(default=None, max_length=160)
    inregi: str | None = Field(default=None, max_length=160)
    inner_size: str | None = Field(default=None, max_length=160)
    outer_size: str | None = Field(default=None, max_length=160)
    source_port: Literal["top", "right", "bottom", "left"] = "bottom"
    target_port: Literal["top", "right", "bottom", "left"] = "top"
    same_group: str | None = None
    attached_relation_id: uuid.UUID | None = None
    waypoints: list[dict[str, float]] | None = None


class RelationCreate(RelationBase):
    extras: list[RelationExtraCreate] = Field(default_factory=list)


class RelationUpdate(BaseModel):
    parent_endpoint_type: Literal["layer", "spare"] | None = None
    child_endpoint_type: Literal["layer", "spare"] | None = None
    parent_layer_id: uuid.UUID | None = None
    child_layer_id: uuid.UUID | None = None
    key_layout_type_id: uuid.UUID | None = None
    key_drawing_type_id: uuid.UUID | None = None
    relation_type: str | None = None
    relation_style_id: uuid.UUID | None = None
    parent_drawing_type_id: uuid.UUID | None = None
    child_drawing_type_id: uuid.UUID | None = None
    comment: str | None = None
    key_priority: str | None = Field(default=None, max_length=120)
    priority_rule: str | None = None
    final_type: str | None = Field(default=None, max_length=160)
    key_purpose: str | None = Field(default=None, max_length=160)
    placement: str | None = Field(default=None, max_length=160)
    stack_type: str | None = Field(default=None, max_length=160)
    inregi: str | None = Field(default=None, max_length=160)
    inner_size: str | None = Field(default=None, max_length=160)
    outer_size: str | None = Field(default=None, max_length=160)
    source_port: Literal["top", "right", "bottom", "left"] | None = None
    target_port: Literal["top", "right", "bottom", "left"] | None = None
    same_group: str | None = None
    attached_relation_id: uuid.UUID | None = None
    waypoints: list[dict[str, float]] | None = None
    extras: list[RelationExtraCreate] | None = None


class RelationRead(OrmModel, RelationBase):
    id: uuid.UUID
    project_id: uuid.UUID
    align_tree_id: uuid.UUID | None = None
    extras: list[RelationExtraRead] = Field(default_factory=list)


class RelationImportRow(BaseModel):
    row_number: int = Field(ge=1)
    relation: RelationCreate


class RelationImportRequest(BaseModel):
    rows: list[RelationImportRow] = Field(min_length=1, max_length=5000)


class RelationImportIssue(BaseModel):
    row_number: int | None = None
    code: str
    message: str


class RelationImportPreview(BaseModel):
    total_count: int
    create_count: int
    error_count: int
    issues: list[RelationImportIssue] = Field(default_factory=list)


class TextBoxBase(BaseModel):
    text: str = "Text"
    shape_type: Literal["text", "rectangle", "ellipse"] = "text"
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
    shape_type: Literal["text", "rectangle", "ellipse"] | None = None
    x: float | None = None
    y: float | None = None
    width: float | None = Field(default=None, ge=40)
    height: float | None = Field(default=None, ge=24)
    text_color: str | None = None
    font_size: int | None = Field(default=None, ge=8, le=96)
    background_color: str | None = None
    border_color: str | None = None
    locked: bool | None = None


class TextBoxBatchUpdate(TextBoxUpdate):
    id: uuid.UUID


class TextBoxRead(OrmModel, TextBoxBase):
    id: uuid.UUID
    project_id: uuid.UUID
    align_tree_id: uuid.UUID | None = None


class GraphRead(BaseModel):
    project: ProjectRead
    align_tree: AlignTreeRead | None = None
    layers: list[LayerRead]
    layouts: list[LayoutRead]
    styles: list[StyleRead]
    box_presets: list[BoxPresetRead]
    relation_styles: list[RelationStyleRead]
    relations: list[RelationRead]
    text_boxes: list[TextBoxRead]
    validation: "ValidationReport"


class RelationImportCommitResult(BaseModel):
    created_count: int
    graph: GraphRead


class GraphUpdate(BaseModel):
    layers: list[LayerRead] | None = None
    layouts: list[LayoutRead] | None = None
    styles: list[StyleRead] | None = None
    box_presets: list[BoxPresetRead] | None = None
    relation_styles: list[RelationStyleRead] | None = None
    relations: list[RelationRead] | None = None
    text_boxes: list[TextBoxRead] | None = None


class GraphBatchUpdate(BaseModel):
    layer_presets: list[LayerPresetBatchUpdate] = Field(default_factory=list)
    layouts: list[LayoutBatchUpdate] = Field(default_factory=list)
    styles: list[StyleBatchUpdate] = Field(default_factory=list)
    text_boxes: list[TextBoxBatchUpdate] = Field(default_factory=list)


class GraphRestore(BaseModel):
    layers: list[LayerRead] = Field(default_factory=list)
    layouts: list[LayoutRead] = Field(default_factory=list)
    styles: list[StyleRead] = Field(default_factory=list)
    box_presets: list[BoxPresetRead] = Field(default_factory=list)
    relation_styles: list[RelationStyleRead] = Field(default_factory=list)
    relations: list[RelationRead] = Field(default_factory=list)
    text_boxes: list[TextBoxRead] = Field(default_factory=list)


class SnapshotCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=1000)


class SnapshotSummary(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    align_tree_id: uuid.UUID
    name: str
    description: str | None = None
    created_by_actor_id: uuid.UUID | None = None
    created_by_label: str
    project_revision: int
    summary: dict[str, int] = Field(default_factory=dict)
    created_at: datetime


class SnapshotDetail(SnapshotSummary):
    graph: GraphRestore
    tree: dict[str, Any] = Field(default_factory=dict)


class SnapshotDiffItem(BaseModel):
    id: str
    label: str


class SnapshotDiffSection(BaseModel):
    added: int = 0
    removed: int = 0
    modified: int = 0
    added_items: list[SnapshotDiffItem] = Field(default_factory=list)
    removed_items: list[SnapshotDiffItem] = Field(default_factory=list)
    modified_items: list[SnapshotDiffItem] = Field(default_factory=list)


class SnapshotVersionLabel(BaseModel):
    id: uuid.UUID | None = None
    name: str
    created_at: datetime | None = None


class SnapshotDiff(BaseModel):
    base: SnapshotVersionLabel
    target: SnapshotVersionLabel
    layers: SnapshotDiffSection
    relations: SnapshotDiffSection
    text_boxes: SnapshotDiffSection
    tree_fields: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    has_changes: bool = False


class ProjectBundleMetadata(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None


class ProjectBundle(BaseModel):
    format: Literal["ric-align-tree"] = "ric-align-tree"
    schema_version: Literal[1] = 1
    exported_at: datetime
    project: ProjectBundleMetadata
    graph: GraphRestore


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
