export type PortName = "top" | "right" | "bottom" | "left";
export type EditorMode = "select" | "connect" | "text";
export type AppView = "home" | "reference" | "layer-master" | "projects" | "data" | "editor" | "validation" | "export";
export type SelectionItem = { kind: "layer" | "relation" | "text"; id: string };
export type Point = { x: number; y: number };

export interface Project { id: string; name: string; description: string | null; created_at: string; updated_at: string }
export interface ProjectCreate { name: string; description?: string | null }

export interface Layer {
  id: string; project_id: string; name: string; step: string | null; layer_property: string | null;
  align: string | null; align_side: string | null; description: string | null; metadata_json: Record<string, unknown>;
  box_preset_id: string | null; pending_group: string | null; created_at: string; updated_at: string;
}
export interface LayerCreate {
  name: string; step?: string | null; layer_property?: string | null; align?: string | null; align_side?: string | null;
  description?: string | null; metadata_json?: Record<string, unknown>; box_preset_id?: string | null; pending_group?: string | null;
  x?: number; y?: number; width?: number; height?: number;
}
export interface LayerUpdate {
  name?: string; step?: string | null; layer_property?: string | null; align?: string | null; align_side?: string | null;
  description?: string | null; metadata_json?: Record<string, unknown>; box_preset_id?: string | null; pending_group?: string | null;
}

export interface Layout { id: string; project_id: string; layer_id: string; x: number; y: number; width: number; height: number; z_index: number }
export interface LayoutUpdate { x?: number; y?: number; width?: number; height?: number; z_index?: number }
export interface LayoutBatchUpdate extends LayoutUpdate { layer_id: string }

export interface ShapeStyle { id: string; project_id: string; layer_id: string; fill_color: string; stroke_color: string; text_color: string; font_size: number; stroke_width: number }
export interface StyleUpdate { fill_color?: string; stroke_color?: string; text_color?: string; font_size?: number; stroke_width?: number }
export interface StyleBatchUpdate extends StyleUpdate { layer_id: string }

export interface Relation {
  id: string; project_id: string; parent_layer_id: string | null; child_layer_id: string | null; relation_type: string;
  instance: string | null; relation_style_id: string | null; source_port: PortName; target_port: PortName;
  same_group: string | null; attached_relation_id: string | null; waypoints: Point[]; created_at: string; updated_at: string;
}
export interface RelationCreate {
  parent_layer_id?: string | null; child_layer_id?: string | null; relation_type?: string; instance?: string | null;
  relation_style_id?: string | null; source_port?: PortName; target_port?: PortName; same_group?: string | null;
  attached_relation_id?: string | null; waypoints?: Point[];
}
export interface RelationUpdate {
  parent_layer_id?: string | null; child_layer_id?: string | null; relation_type?: string | null; instance?: string | null;
  relation_style_id?: string | null; source_port?: PortName | null; target_port?: PortName | null; same_group?: string | null;
  attached_relation_id?: string | null; waypoints?: Point[] | null;
}

export interface RelationStyle { id: string; name: string; stroke_color: string; stroke_width: number; line_pattern: "solid" | "dashed" | "dotted" | "reference"; marker_type: "arrow" | "none"; sort_order: number }
export type RelationStyleCreate = Omit<RelationStyle, "id">;
export type RelationStyleUpdate = Partial<RelationStyleCreate>;

export interface BoxPreset { id: string; name: string; fill_color: string; stroke_color: string; text_color: string; font_size: number; width: number; height: number; stroke_width: number; is_default: boolean; sort_order: number }
export type BoxPresetCreate = Omit<BoxPreset, "id">;
export type BoxPresetUpdate = Partial<BoxPresetCreate>;

export interface TextBox { id: string; project_id: string; text: string; x: number; y: number; width: number; height: number; text_color: string; font_size: number; background_color: string; border_color: string; locked: boolean }
export interface TextBoxCreate { text?: string; x?: number; y?: number; width?: number; height?: number; text_color?: string; font_size?: number; background_color?: string; border_color?: string; locked?: boolean }
export interface TextBoxUpdate extends TextBoxCreate {}
export interface TextBoxBatchUpdate extends TextBoxUpdate { id: string }

export interface ValidationIssue { code: string; severity: "error" | "warning"; message: string; relation_id?: string | null; layer_id?: string | null }
export interface ValidationReport { ok: boolean; issues: ValidationIssue[] }
export interface Graph { project: Project; layers: Layer[]; layouts: Layout[]; styles: ShapeStyle[]; box_presets: BoxPreset[]; relation_styles: RelationStyle[]; relations: Relation[]; text_boxes: TextBox[]; validation: ValidationReport }

export interface GraphBatchUpdate { layouts?: LayoutBatchUpdate[]; styles?: StyleBatchUpdate[]; text_boxes?: TextBoxBatchUpdate[] }
export interface GraphRestore { layers: Layer[]; layouts: Layout[]; styles: ShapeStyle[]; relations: Relation[]; text_boxes: TextBox[] }
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

export interface LayerMaster { id: string; name: string; layer_number: string | null; mask_main_fld: string | null; mask_sl_fld: string | null; pr_wf: string | null; dev_wf: string | null; pr_type: string | null; light_source: string | null; pr_open_close: string | null; validation_rule: string | null; comment: string | null; priorities: Record<string, string | null> }
export type LayerMasterCreate = Omit<LayerMaster, "id">;
export type LayerMasterUpdate = Partial<LayerMasterCreate>;

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
