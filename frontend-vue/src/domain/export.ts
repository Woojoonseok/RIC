import PptxGenJS from "pptxgenjs";
import * as XLSX from "xlsx-js-style";

import { relationPoints, relationStroke } from "./geometry";
import type { Graph, Layer, Point } from "../types";

const PPTX_WIDTH = 13.333;
const PPTX_HEIGHT = 7.5;
const PPTX_MARGIN = 0.35;

export interface PptxCanvasTransform {
  minX: number;
  minY: number;
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface CanvasContentBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export function canvasContentBounds(graph: Graph): CanvasContentBounds {
  const layouts = new Map(graph.layouts.map((row) => [row.layer_id, row]));
  const relations = new Map(graph.relations.map((row) => [row.id, row]));
  const points: Point[] = [];
  for (const layout of graph.layouts) {
    points.push({ x: layout.x, y: layout.y }, { x: layout.x + layout.width, y: layout.y + layout.height });
  }
  for (const row of graph.text_boxes) {
    points.push({ x: row.x, y: row.y }, { x: row.x + row.width, y: row.y + row.height });
  }
  for (const relation of graph.relations) points.push(...relationPoints(relation, layouts, relations));

  if (!points.length) points.push({ x: 0, y: 0 }, { x: 1600, y: 1000 });
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  return { minX, minY, width, height };
}

export function pptxCanvasTransform(graph: Graph): PptxCanvasTransform {
  const { minX, minY, width, height } = canvasContentBounds(graph);
  const scale = Math.min((PPTX_WIDTH - PPTX_MARGIN * 2) / width, (PPTX_HEIGHT - PPTX_MARGIN * 2) / height);
  return {
    minX, minY, width, height, scale,
    offsetX: (PPTX_WIDTH - width * scale) / 2,
    offsetY: (PPTX_HEIGHT - height * scale) / 2,
  };
}

function pptxPoint(point: Point, transform: PptxCanvasTransform): Point {
  return {
    x: transform.offsetX + (point.x - transform.minX) * transform.scale,
    y: transform.offsetY + (point.y - transform.minY) * transform.scale,
  };
}

export function pptxLinePosition(start: Point, end: Point, transform: PptxCanvasTransform) {
  const source = pptxPoint(start, transform);
  const target = pptxPoint(end, transform);
  return {
    x: Math.min(source.x, target.x),
    y: Math.min(source.y, target.y),
    w: Math.abs(target.x - source.x),
    h: Math.abs(target.y - source.y),
    flipH: target.x < source.x,
    flipV: target.y < source.y,
  };
}

export function layerExportLabel(layer: Pick<Layer, "name" | "step">, labelField: "name" | "step") {
  return labelField === "step" ? layer.step?.trim() || layer.name : layer.name;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportBaseName(graph: Graph) {
  const raw = `${graph.project.name}_${graph.align_tree?.name ?? "Align_Tree"}`;
  return raw.replace(/[\\/:*?"<>|]+/g, "_").trim() || "RIC_Align_Tree";
}

export function exportExcel(graph: Graph, template = false) {
  const workbook = XLSX.utils.book_new();
  const layerRows = template ? [["Layer", "Step", "Property", "Align", "Align Side", "Group"]] : graph.layers.map((row) => [row.name, row.step, row.layer_property, row.align, row.align_side, row.pending_group]);
  const relationRows = template
    ? [[
        "Key Layout Type", "Key Drawing Type", "Parent", "Child", "Comment", "Relation Type",
        "Parent Drawing", "Child Drawing", "Key Priority", "Priority Rule",
        "Type", "Key Purpose", "Placement", "Stack Type", "INREGI",
        "Inner Size", "Outer Size", "Source Port", "Target Port", "Extra Count",
      ]]
    : graph.relations.map((row) => [
        row.key_layout_type_id, row.key_drawing_type_id, row.parent_layer_id, row.child_layer_id,
        row.comment, row.relation_type, row.parent_drawing_type_id, row.child_drawing_type_id,
        row.key_priority, row.priority_rule, row.final_type, row.key_purpose, row.placement,
        row.stack_type, row.inregi, row.inner_size, row.outer_size,
        row.source_port, row.target_port, row.extras.length,
      ]);
  const validationRows = template ? [["Severity", "Code", "Message"]] : graph.validation.issues.map((row) => [row.severity, row.code, row.message]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(layerRows), "Align_Input");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(relationRows), "Layer_Relation");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(validationRows), "Validation_Result");
  XLSX.writeFile(workbook, template ? "RIC_Align_Template.xlsx" : `${exportBaseName(graph)}.xlsx`);
}

export function exportExcelTemplate() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Step", "Layer", "Layer_Property", "Align", "Align_side", "Description", "Group"],
    ["S01", "WL", "Main", "AA01", "LEFT", "", ""],
  ]), "Align_Input");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Parent_Layer", "Child_Layer", "Relation_Type", "Source_Port", "Target_Port", "Same Group"],
    ["WL", "BL", "Align", "bottom", "top", ""],
  ]), "Layer_Relation");
  XLSX.writeFile(workbook, "RIC_Align_Template.xlsx");
}

export function graphSvg(graph: Graph) {
  const layouts = new Map(graph.layouts.map((row) => [row.layer_id, row]));
  const relations = new Map(graph.relations.map((row) => [row.id, row]));
  const styles = new Map(graph.styles.map((row) => [row.layer_id, row]));
  const relationStyles = new Map(graph.relation_styles.map((row) => [row.id, row]));
  const bounds = canvasContentBounds(graph);
  const padding = 40;
  const viewBox = [
    bounds.minX - padding,
    bounds.minY - padding,
    bounds.width + padding * 2,
    bounds.height + padding * 2,
  ].join(" ");
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const backgroundMarkup = graph.text_boxes.filter((row) => (row.shape_type ?? "text") !== "text").map((row) => (
    row.shape_type === "ellipse"
      ? `<ellipse cx="${row.x + row.width / 2}" cy="${row.y + row.height / 2}" rx="${row.width / 2}" ry="${row.height / 2}" fill="${row.background_color}" stroke="${row.border_color}" stroke-width="2"/>`
      : `<rect x="${row.x}" y="${row.y}" width="${row.width}" height="${row.height}" fill="${row.background_color}" stroke="${row.border_color}" stroke-width="2"/>`
  )).join("");
  const relationMarkup = graph.relations.map((relation) => {
    const points = relationPoints(relation, layouts, relations);
    const style = relation.relation_style_id ? relationStyles.get(relation.relation_style_id) : undefined;
    return `<polyline points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="none" stroke="${style?.stroke_color ?? "#344054"}" stroke-width="${style?.stroke_width ?? 2}" marker-end="url(#arrow)"/>`;
  }).join("");
  const layerMarkup = graph.layers.map((layer) => {
    const layout = layouts.get(layer.id); if (!layout) return "";
    const style = styles.get(layer.id);
    const lines = layer.name.split("\n");
    return `<g><rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="12" fill="${style?.fill_color ?? "#fff"}" stroke="${style?.stroke_color ?? "#175cd3"}" stroke-width="${style?.stroke_width ?? 2}"/>${lines.map((line, index) => `<text x="${layout.x + layout.width / 2}" y="${layout.y + layout.height / 2 + (index - (lines.length - 1) / 2) * 18}" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="${style?.font_size ?? 14}" fill="${style?.text_color ?? "#101828"}">${escape(line)}</text>`).join("")}</g>`;
  }).join("");
  const textMarkup = graph.text_boxes.filter((row) => (row.shape_type ?? "text") === "text").map((row) => (
    `<g><rect x="${row.x}" y="${row.y}" width="${row.width}" height="${row.height}" fill="${row.background_color}" stroke="${row.border_color}"/><text x="${row.x + 8}" y="${row.y + row.height / 2}" dominant-baseline="middle" font-family="Arial" font-size="${row.font_size}" fill="${row.text_color}">${escape(row.text)}</text></g>`
  )).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#344054"/></marker></defs><rect x="${bounds.minX - padding}" y="${bounds.minY - padding}" width="${bounds.width + padding * 2}" height="${bounds.height + padding * 2}" fill="white"/>${backgroundMarkup}${relationMarkup}${layerMarkup}${textMarkup}</svg>`;
}

export function exportSvg(graph: Graph) { download(new Blob([graphSvg(graph)], { type: "image/svg+xml" }), `${exportBaseName(graph)}.svg`) }

export async function exportPptx(graph: Graph, labelField: "name" | "step" = "name") {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "RIC Align Tree Editor";
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  const transform = pptxCanvasTransform(graph);
  const position = (x: number, y: number, width: number, height: number) => ({
    x: transform.offsetX + (x - transform.minX) * transform.scale,
    y: transform.offsetY + (y - transform.minY) * transform.scale,
    w: width * transform.scale,
    h: height * transform.scale,
  });
  const fontScale = Math.max(0.5, Math.min(2, transform.scale / (PPTX_WIDTH / 1600)));
  const layouts = new Map(graph.layouts.map((row) => [row.layer_id, row]));
  const relations = new Map(graph.relations.map((row) => [row.id, row]));
  const styles = new Map(graph.styles.map((row) => [row.layer_id, row]));
  const relationStyles = new Map(graph.relation_styles.map((row) => [row.id, row]));
  for (const row of graph.text_boxes.filter((item) => (item.shape_type ?? "text") !== "text")) {
    slide.addShape(row.shape_type === "ellipse" ? pptx.ShapeType.ellipse : pptx.ShapeType.rect, {
      ...position(row.x, row.y, row.width, row.height),
      fill: { color: row.background_color.replace("#", "") },
      line: { color: row.border_color.replace("#", ""), width: 1.5 },
    });
  }
  for (const relation of graph.relations) {
    const points = relationPoints(relation, layouts, relations);
    const relationStyle = relation.relation_style_id ? relationStyles.get(relation.relation_style_id) : undefined;
    const stroke = relationStroke(relationStyle, relation.relation_type, relation.same_group);
    const dashType = relationStyle?.line_pattern === "dashed" ? "dash"
      : relationStyle?.line_pattern === "dotted" ? "sysDot"
        : relationStyle?.line_pattern === "reference" ? "dashDot"
          : stroke.strokeDasharray?.includes("2 5") ? "sysDot"
            : stroke.strokeDasharray ? "dashDot" : "solid";
    points.slice(0, -1).forEach((point, index) => {
      const end = points[index + 1];
      slide.addShape(pptx.ShapeType.line, {
        ...pptxLinePosition(point, end, transform),
        line: {
          color: stroke.stroke.replace("#", ""),
          width: stroke.strokeWidth,
          dashType,
          endArrowType: index === points.length - 2 && stroke.markerEnd ? "triangle" : "none",
        },
      });
    });
  }
  for (const layer of graph.layers) {
    const layout = layouts.get(layer.id); if (!layout) continue;
    const style = styles.get(layer.id);
    slide.addText(layerExportLabel(layer, labelField), {
      ...position(layout.x, layout.y, layout.width, layout.height),
      shape: pptx.ShapeType.roundRect, margin: 0.06, align: "center", valign: "middle",
      color: (style?.text_color ?? "#101828").replace("#", ""), fontSize: (style?.font_size ?? 14) * fontScale,
      fill: { color: (style?.fill_color ?? "#FFFFFF").replace("#", "") },
      line: { color: (style?.stroke_color ?? "#175CD3").replace("#", ""), width: style?.stroke_width ?? 2 },
    });
  }
  for (const row of graph.text_boxes.filter((item) => (item.shape_type ?? "text") === "text")) {
    slide.addText(row.text, {
      ...position(row.x, row.y, row.width, row.height),
      margin: 0.06, color: row.text_color.replace("#", ""), fontSize: row.font_size * fontScale,
      fill: { color: row.background_color.replace("#", "") },
      line: { color: row.border_color.replace("#", ""), width: 1 },
    });
  }
  await pptx.writeFile({ fileName: `${exportBaseName(graph)}.pptx` });
}
