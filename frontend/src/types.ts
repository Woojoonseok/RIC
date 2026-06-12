export type PortName = "top" | "right" | "bottom" | "left";
export type SelectionKind = "layer" | "relation" | "text";
export type EditorMode = "select" | "connect" | "text";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Layer {
  id: string;
  project_id: string;
  name: string;
  step: string | null;
  layer_property: string | null;
  align: string | null;
  align_side: string | null;
  metadata_json: Record<string, unknown>;
}

export interface Layout {
  id: string;
  project_id: string;
  layer_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
}

export interface ShapeStyle {
  id: string;
  project_id: string;
  layer_id: string;
  fill_color: string;
  stroke_color: string;
  text_color: string;
  font_size: number;
  stroke_width: number;
}

export interface RelationStyle {
  id: string;
  project_id: string;
  name: string;
  stroke_color: string;
  stroke_width: number;
  line_pattern: "solid" | "dashed" | "dotted" | "reference";
  marker_type: "arrow" | "none";
  sort_order: number;
}

export interface Relation {
  id: string;
  project_id: string;
  parent_layer_id: string;
  child_layer_id: string;
  relation_type: string;
  relation_style_id: string | null;
  source_port: PortName;
  target_port: PortName;
}

export interface TextBox {
  id: string;
  project_id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text_color: string;
  font_size: number;
  background_color: string;
  border_color: string;
  locked: boolean;
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  relation_id?: string | null;
  layer_id?: string | null;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
}

export interface Graph {
  project: Project;
  layers: Layer[];
  layouts: Layout[];
  styles: ShapeStyle[];
  relation_styles: RelationStyle[];
  relations: Relation[];
  text_boxes: TextBox[];
  validation: ValidationReport;
}

export interface SelectionItem {
  kind: SelectionKind;
  id: string;
}
