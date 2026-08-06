export type PortName = "top" | "right" | "bottom" | "left";
export type EditorMode = "select" | "connect" | "text" | "shape-rectangle" | "shape-ellipse";
export type AppView = "home" | "reference" | "layer-master" | "projects" | "data" | "editor" | "validation" | "export";
export type SelectionItem = { kind: "layer" | "relation" | "text"; id: string };
export type Point = { x: number; y: number };

export type ProjectRole = "owner" | "admin" | "editor" | "viewer";
export type AccessRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export interface ProjectLockSummary {
  locked: boolean;
  mine?: boolean;
  holder_label?: string | null;
  expires_at?: string | null;
}
export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  access_role?: ProjectRole;
  role?: ProjectRole;
  is_owner?: boolean;
  revision?: number;
  lock?: ProjectLockSummary | null;
  is_locked?: boolean;
  locked?: boolean;
  locked_by_me?: boolean;
  lock_expires_at?: string | null;
  lock_holder_display_name?: string | null;
  creator_id?: string | null;
  creator_display_name?: string | null;
  creator?: { id: string; display_name: string } | null;
  my_role?: ProjectRole | null;
  membership_role?: ProjectRole | null;
  access_request_status?: AccessRequestStatus | null;
  align_tree_count?: number;
  member_count?: number;
  is_public?: boolean;
  is_legacy_unclaimed?: boolean;
}
export interface ProjectCreate { name: string; description?: string | null }
export interface ProjectUpdate { name?: string; description?: string | null }
export interface AnonymousSession { id: string; display_name?: string; identity_provider?: "anonymous" | string; ip_hint?: string | null }
export interface EditLease {
  project_id?: string;
  lease_token: string;
  token?: string;
  client_instance_id?: string;
  expires_at: string;
  revision?: number;
}
export interface AlignTree {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
  process_name?: string | null;
  gds_name?: string | null;
  layer_process_names?: Record<string, string>;
  layer_gds_names?: Record<string, string>;
  final_table_cells?: Record<string, Record<string, string>>;
  created_at: string;
  updated_at: string;
  revision?: number;
  is_locked?: boolean;
  locked_by_me?: boolean;
  lock_expires_at?: string | null;
  is_default?: boolean;
  created_by_actor_id?: string | null;
}
export interface AlignTreeCreate {
  name: string;
  description?: string | null;
  process_name?: string | null;
  gds_name?: string | null;
  layer_process_names?: Record<string, string>;
  layer_gds_names?: Record<string, string>;
  final_table_cells?: Record<string, Record<string, string>>;
}
export interface ProjectMember {
  id: string;
  project_id?: string;
  actor_id?: string;
  display_name?: string;
  actor?: { id: string; display_name: string } | null;
  role: ProjectRole;
  added_by_actor_id?: string | null;
  created_at?: string;
  joined_at?: string;
}
export interface UserSummary { id: string; display_name: string }
export interface ProjectAccessRequest {
  id: string;
  project_id: string;
  actor_id?: string;
  display_name?: string;
  actor?: { id: string; display_name: string } | null;
  requester?: { id: string; display_name: string } | null;
  requested_role?: "viewer" | "editor";
  message?: string | null;
  status: AccessRequestStatus;
  requested_at?: string;
  created_at?: string;
  reviewed_at?: string | null;
  reviewed_by?: { id: string; display_name: string } | null;
  decision_note?: string | null;
}
export interface AuditEvent {
  id: string;
  project_id: string;
  align_tree_id?: string | null;
  actor?: { id: string; display_name: string } | null;
  actor_label_snapshot?: string | null;
  actor_display_name?: string | null;
  action?: string;
  event_type?: string;
  target_type?: string;
  target_id?: string | null;
  entity_type?: string | null;
  summary?: string | null;
  payload?: Record<string, unknown>;
  details_json?: Record<string, unknown>;
  created_at: string;
}

export interface Layer {
  id: string; project_id: string; name: string; step: string | null; layer_property: string | null;
  align: string | null; align_side: string | null; description: string | null; metadata_json: Record<string, unknown>;
  box_preset_id: string | null; pending_group: string | null; layer_master_id?: string | null; created_at?: string; updated_at?: string;
}
export interface LayerCreate {
  name: string; step?: string | null; layer_property?: string | null; align?: string | null; align_side?: string | null;
  description?: string | null; metadata_json?: Record<string, unknown>; box_preset_id?: string | null;
  layer_master_id?: string | null; x?: number; y?: number; width?: number; height?: number;
}
export interface LayerUpdate {
  name?: string; step?: string | null; layer_property?: string | null; align?: string | null; align_side?: string | null;
  description?: string | null; metadata_json?: Record<string, unknown>; box_preset_id?: string | null;
}

export interface Layout { id: string; project_id: string; layer_id: string; x: number; y: number; width: number; height: number; z_index: number }
export interface LayoutUpdate { x?: number; y?: number; width?: number; height?: number; z_index?: number }
export interface LayoutBatchUpdate extends LayoutUpdate { layer_id: string }

export interface ShapeStyle { id: string; project_id: string; layer_id: string; fill_color: string; stroke_color: string; text_color: string; font_size: number; stroke_width: number }
export interface StyleUpdate { fill_color?: string; stroke_color?: string; text_color?: string; font_size?: number; stroke_width?: number }
export interface StyleBatchUpdate extends StyleUpdate { layer_id: string }
export interface LayerPresetBatchUpdate { layer_id: string; box_preset_id: string }

export interface RelationExtra {
  id: string;
  project_id: string;
  relation_id: string;
  layer_master_id: string;
  key_drawing_type_id: string;
  sort_order: number;
}
export interface RelationExtraCreate {
  layer_master_id: string;
  key_drawing_type_id: string;
  sort_order?: number;
}
export type RelationEndpointType = "layer" | "spare";
export interface Relation {
  id: string; project_id: string; parent_endpoint_type: RelationEndpointType; child_endpoint_type: RelationEndpointType;
  parent_layer_id: string | null; child_layer_id: string | null; relation_type: string;
  key_layout_type_id: string | null; key_drawing_type_id: string | null; relation_style_id: string | null;
  parent_drawing_type_id: string | null; child_drawing_type_id: string | null;
  comment: string | null; key_priority: string | null; priority_rule: string | null;
  final_type: string | null; key_purpose: string | null; placement: string | null;
  stack_type: string | null; inregi: string | null; inner_size: string | null; outer_size: string | null;
  source_port: PortName; target_port: PortName; extras: RelationExtra[];
  same_group: string | null; attached_relation_id: string | null; waypoints: Point[] | null; created_at?: string; updated_at?: string;
}
export interface RelationCreate {
  parent_endpoint_type?: RelationEndpointType; child_endpoint_type?: RelationEndpointType;
  parent_layer_id?: string | null; child_layer_id?: string | null;
  key_layout_type_id?: string | null; key_drawing_type_id?: string | null; relation_type?: string;
  relation_style_id?: string | null; source_port?: PortName; target_port?: PortName; same_group?: string | null;
  parent_drawing_type_id?: string | null; child_drawing_type_id?: string | null;
  comment?: string | null; key_priority?: string | null; priority_rule?: string | null;
  final_type?: string | null; key_purpose?: string | null; placement?: string | null;
  stack_type?: string | null; inregi?: string | null; inner_size?: string | null; outer_size?: string | null;
  extras?: RelationExtraCreate[];
  attached_relation_id?: string | null; waypoints?: Point[];
}
export interface RelationUpdate {
  parent_endpoint_type?: RelationEndpointType | null; child_endpoint_type?: RelationEndpointType | null;
  parent_layer_id?: string | null; child_layer_id?: string | null;
  key_layout_type_id?: string | null; key_drawing_type_id?: string | null; relation_type?: string | null;
  relation_style_id?: string | null; source_port?: PortName | null; target_port?: PortName | null; same_group?: string | null;
  parent_drawing_type_id?: string | null; child_drawing_type_id?: string | null;
  comment?: string | null; key_priority?: string | null; priority_rule?: string | null;
  final_type?: string | null; key_purpose?: string | null; placement?: string | null;
  stack_type?: string | null; inregi?: string | null; inner_size?: string | null; outer_size?: string | null;
  extras?: RelationExtraCreate[] | null;
  attached_relation_id?: string | null; waypoints?: Point[] | null;
}

export interface RelationImportRow { row_number: number; relation: RelationCreate }
export interface RelationImportRequest { rows: RelationImportRow[] }
export interface RelationImportIssue { row_number: number | null; code: string; message: string }
export interface RelationImportPreview {
  total_count: number;
  create_count: number;
  error_count: number;
  issues: RelationImportIssue[];
}
export interface RelationImportCommitResult { created_count: number; graph: Graph }

export interface RelationStyle { id: string; name: string; stroke_color: string; stroke_width: number; line_pattern: "solid" | "dashed" | "dotted" | "reference"; marker_type: "arrow" | "none"; sort_order: number }
export type RelationStyleCreate = Omit<RelationStyle, "id">;
export type RelationStyleUpdate = Partial<RelationStyleCreate>;

export interface BoxPreset { id: string; name: string; fill_color: string; stroke_color: string; text_color: string; font_size: number; width: number; height: number; stroke_width: number; is_default: boolean; sort_order: number }
export type BoxPresetCreate = Omit<BoxPreset, "id">;
export type BoxPresetUpdate = Partial<BoxPresetCreate>;

export type CanvasObjectType = "text" | "rectangle" | "ellipse";
export interface TextBox { id: string; project_id: string; text: string; shape_type: CanvasObjectType; x: number; y: number; width: number; height: number; text_color: string; font_size: number; background_color: string; border_color: string; locked: boolean }
export interface TextBoxCreate { text?: string; shape_type?: CanvasObjectType; x?: number; y?: number; width?: number; height?: number; text_color?: string; font_size?: number; background_color?: string; border_color?: string; locked?: boolean }
export interface TextBoxUpdate extends TextBoxCreate {}
export interface TextBoxBatchUpdate extends TextBoxUpdate { id: string }

export interface ValidationIssue { code: string; severity: "error" | "warning"; message: string; relation_id?: string | null; layer_id?: string | null }
export interface ValidationReport { ok: boolean; issues: ValidationIssue[] }
export interface Graph { project: Project; align_tree?: AlignTree; layers: Layer[]; layouts: Layout[]; styles: ShapeStyle[]; box_presets: BoxPreset[]; relation_styles: RelationStyle[]; relations: Relation[]; text_boxes: TextBox[]; validation: ValidationReport }

export interface GraphBatchUpdate { layer_presets?: LayerPresetBatchUpdate[]; layouts?: LayoutBatchUpdate[]; styles?: StyleBatchUpdate[]; text_boxes?: TextBoxBatchUpdate[] }
export interface GraphUpdate { layers?: Layer[]; layouts?: Layout[]; styles?: ShapeStyle[]; box_presets?: BoxPreset[]; relation_styles?: RelationStyle[]; relations?: Relation[]; text_boxes?: TextBox[] }
export interface GraphRestore { layers: Layer[]; layouts: Layout[]; styles: ShapeStyle[]; box_presets: BoxPreset[]; relation_styles: RelationStyle[]; relations: Relation[]; text_boxes: TextBox[] }
export interface SnapshotCreate { name: string; description?: string | null }
export interface SnapshotSummary {
  id: string;
  project_id: string;
  align_tree_id: string;
  name: string;
  description?: string | null;
  created_by_actor_id?: string | null;
  created_by_label: string;
  project_revision: number;
  summary: { layers?: number; relations?: number; text_boxes?: number };
  created_at: string;
}
export interface SnapshotDetail extends SnapshotSummary { graph: GraphRestore; tree: Record<string, unknown> }
export interface SnapshotDiffItem { id: string; label: string }
export interface SnapshotDiffSection {
  added: number;
  removed: number;
  modified: number;
  added_items: SnapshotDiffItem[];
  removed_items: SnapshotDiffItem[];
  modified_items: SnapshotDiffItem[];
}
export interface SnapshotVersionLabel { id?: string | null; name: string; created_at?: string | null }
export interface SnapshotDiff {
  base: SnapshotVersionLabel;
  target: SnapshotVersionLabel;
  layers: SnapshotDiffSection;
  relations: SnapshotDiffSection;
  text_boxes: SnapshotDiffSection;
  tree_fields: string[];
  warnings: string[];
  has_changes: boolean;
}
export interface LayerMergeRequest { layer_ids: string[]; name?: string | null }
export interface LayerSplitRequest { orientation?: "vertical" | "horizontal" }

export interface KeyLayoutType { id: string; name: string; scribe_lane_rows: number | null; sort_order: number }
export type KeyLayoutTypeCreate = Omit<KeyLayoutType, "id">;
export type KeyLayoutTypeUpdate = Partial<KeyLayoutTypeCreate>;
export interface KeyDrawingType { id: string; symbol: string | null; trench_mesa: string | null; key_shape: string | null; ri_notation: string | null; drawing_guide: string | null; gds_path: string | null; sort_order: number }
export type KeyDrawingTypeCreate = Omit<KeyDrawingType, "id">;
export type KeyDrawingTypeUpdate = Partial<KeyDrawingTypeCreate>;
export interface KeyShape { id: string; key_shape: string; drawing_guide: string | null; sort_order: number }
export type KeyShapeCreate = Omit<KeyShape, "id">;
export type KeyShapeUpdate = Partial<KeyShapeCreate>;

export interface LayerMaster { id: string; name: string; layer_number: string | null; mask_main_fld: string | null; mask_sl_fld: string | null; pr_wf: string | null; dev_wf: string | null; pr_type: string | null; light_source: string | null; pr_open_close: string | null; group: string | null; validation_rule: string | null; comment: string | null; priorities: Record<string, string | null> }
export type LayerMasterCreate = Omit<LayerMaster, "id" | "layer_number"> & { layer_number: string };
export type LayerMasterUpdate = Partial<LayerMasterCreate>;
export interface LayerMasterImportRow { row_number: number; layer: LayerMasterCreate }
export interface LayerMasterImportRequest { rows: LayerMasterImportRow[] }
export interface LayerMasterImportIssue { row_number: number | null; code: string; message: string }
export interface LayerMasterImportPreview {
  total_count: number;
  create_count: number;
  error_count: number;
  issues: LayerMasterImportIssue[];
}
export interface LayerMasterImportCommitResult { created_count: number; rows: LayerMaster[] }

export type ReferenceResource = "key-layout-types" | "key-drawing-types" | "key-shapes" | "relation-styles" | "box-presets";
export interface ReferenceReadMap {
  "key-layout-types": KeyLayoutType; "key-drawing-types": KeyDrawingType; "key-shapes": KeyShape;
  "relation-styles": RelationStyle; "box-presets": BoxPreset;
}
export interface ReferenceCreateMap {
  "key-layout-types": KeyLayoutTypeCreate; "key-drawing-types": KeyDrawingTypeCreate; "key-shapes": KeyShapeCreate;
  "relation-styles": RelationStyleCreate; "box-presets": BoxPresetCreate;
}
export interface ReferenceUpdateMap {
  "key-layout-types": KeyLayoutTypeUpdate; "key-drawing-types": KeyDrawingTypeUpdate; "key-shapes": KeyShapeUpdate;
  "relation-styles": RelationStyleUpdate; "box-presets": BoxPresetUpdate;
}
