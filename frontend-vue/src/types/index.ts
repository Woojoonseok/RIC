export type PortName = "top" | "right" | "bottom" | "left";
export type EditorMode = "select" | "connect" | "text";
export type AppView = "home" | "reference" | "layer-master" | "projects" | "data" | "editor" | "validation" | "export";
export type SelectionItem = { kind: "layer" | "relation" | "text"; id: string };
export type Point = { x: number; y: number };

export interface Project { id: string; name: string; description: string | null; created_at: string; updated_at: string }
export interface Layer {
  id: string; project_id: string; name: string; step: string | null; layer_property: string | null;
  align: string | null; align_side: string | null; description: string | null; metadata_json: Record<string, unknown>;
  box_preset_id: string | null; pending_group: string | null; created_at: string; updated_at: string;
}
export interface Layout { id: string; project_id: string; layer_id: string; x: number; y: number; width: number; height: number; z_index: number }
export interface ShapeStyle { id: string; project_id: string; layer_id: string; fill_color: string; stroke_color: string; text_color: string; font_size: number; stroke_width: number }
export interface Relation {
  id: string; project_id: string; parent_layer_id: string | null; child_layer_id: string | null; relation_type: string;
  instance: string | null; relation_style_id: string | null; source_port: PortName; target_port: PortName;
  same_group: string | null; attached_relation_id: string | null; waypoints: Point[]; created_at: string; updated_at: string;
}
export interface RelationStyle { id: string; name: string; stroke_color: string; stroke_width: number; line_pattern: "solid" | "dashed" | "dotted" | "reference"; marker_type: "arrow" | "none"; sort_order: number }
export interface BoxPreset { id: string; name: string; fill_color: string; stroke_color: string; text_color: string; font_size: number; width: number; height: number; stroke_width: number; is_default: boolean; sort_order: number }
export interface TextBox { id: string; project_id: string; text: string; x: number; y: number; width: number; height: number; text_color: string; font_size: number; background_color: string; border_color: string; locked: boolean }
export interface ValidationIssue { code: string; severity: "error" | "warning"; message: string; relation_id?: string | null; layer_id?: string | null }
export interface ValidationReport { ok: boolean; issues: ValidationIssue[] }
export interface Graph { project: Project; layers: Layer[]; layouts: Layout[]; styles: ShapeStyle[]; box_presets: BoxPreset[]; relation_styles: RelationStyle[]; relations: Relation[]; text_boxes: TextBox[]; validation: ValidationReport }

export interface KeyLayoutType { id: string; name: string; scribe_lane_rows: number | null; sort_order: number }
export interface KeyDrawingType { id: string; symbol: string | null; trench_mesa: string | null; key_shape: string | null; ri_notation: string | null; drawing_guide: string | null; gds_path: string | null; sort_order: number }
export interface KeyShape { id: string; key_shape: string; drawing_guide: string | null; sort_order: number }
export interface LayerMaster { id: string; name: string; layer_number: string | null; mask_main_fld: string | null; mask_sl_fld: string | null; pr_wf: string | null; dev_wf: string | null; pr_type: string | null; light_source: string | null; pr_open_close: string | null; validation_rule: string | null; comment: string | null; priorities: Record<string, string | null> }

export interface GraphBatchUpdate {
  layouts?: Array<{ layer_id: string; x?: number; y?: number; width?: number; height?: number; z_index?: number }>;
  styles?: Array<{ layer_id: string; fill_color?: string; stroke_color?: string; text_color?: string; font_size?: number; stroke_width?: number }>;
  text_boxes?: Array<Partial<TextBox> & { id: string }>;
}
