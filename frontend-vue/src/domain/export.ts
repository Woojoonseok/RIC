import PptxGenJS from "pptxgenjs";
import * as XLSX from "xlsx-js-style";

import { relationPoints } from "./geometry";
import type { Graph } from "../types";

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
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#344054"/></marker></defs><rect width="1600" height="1000" fill="white"/>${relationMarkup}${layerMarkup}</svg>`;
}

export function exportSvg(graph: Graph) { download(new Blob([graphSvg(graph)], { type: "image/svg+xml" }), `${exportBaseName(graph)}.svg`) }

export async function exportPptx(graph: Graph) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "RIC Align Tree Editor";
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  const scaleX = 13.33 / 1600;
  const scaleY = 7.5 / 1000;
  const layouts = new Map(graph.layouts.map((row) => [row.layer_id, row]));
  const relations = new Map(graph.relations.map((row) => [row.id, row]));
  const styles = new Map(graph.styles.map((row) => [row.layer_id, row]));
  for (const relation of graph.relations) {
    const points = relationPoints(relation, layouts, relations);
    points.slice(0, -1).forEach((point, index) => {
      const end = points[index + 1];
      slide.addShape(pptx.ShapeType.line, {
        x: point.x * scaleX, y: point.y * scaleY, w: (end.x - point.x) * scaleX, h: (end.y - point.y) * scaleY,
        line: { color: "344054", width: 1.5, endArrowType: index === points.length - 2 ? "triangle" : "none" },
      });
    });
  }
  for (const layer of graph.layers) {
    const layout = layouts.get(layer.id); if (!layout) continue;
    const style = styles.get(layer.id);
    slide.addText(layer.name, {
      x: layout.x * scaleX, y: layout.y * scaleY, w: layout.width * scaleX, h: layout.height * scaleY,
      shape: pptx.ShapeType.roundRect, margin: 0.06, align: "center", valign: "middle",
      color: (style?.text_color ?? "#101828").replace("#", ""), fontSize: style?.font_size ?? 14,
      fill: { color: (style?.fill_color ?? "#FFFFFF").replace("#", "") },
      line: { color: (style?.stroke_color ?? "#175CD3").replace("#", ""), width: style?.stroke_width ?? 2 },
    });
  }
  await pptx.writeFile({ fileName: `${exportBaseName(graph)}.pptx` });
}
