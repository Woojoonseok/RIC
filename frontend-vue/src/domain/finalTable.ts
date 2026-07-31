import type {
  Graph,
  KeyDrawingType,
  KeyLayoutType,
  Layer,
  LayerMaster,
  Relation,
} from "../types";

export interface FinalTableLayer {
  layerId: string;
  number: string;
  marker: string;
}

export interface FinalTableRow {
  relation: Relation;
  keyName: string;
  keyLayoutType: string;
  keyDrawingType: string;
  inner: string;
  outer: string;
}

export interface FinalTableData {
  layers: FinalTableLayer[];
  rows: FinalTableRow[];
}

export function formatLayerNumber(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : text;
}

export function openCloseMarker(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "open" || normalized === "o") return "O";
  if (normalized === "close" || normalized === "closed" || normalized === "c" || normalized === "x") return "X";
  return "";
}

function drawingLabel(row: KeyDrawingType | undefined): string {
  return row?.symbol || row?.key_shape || row?.drawing_guide || "";
}

function keyNumber(value: string): string {
  return value.replace(/\./g, "");
}

function relationOrder(left: Relation, right: Relation): number {
  const created = String(left.created_at || "").localeCompare(String(right.created_at || ""));
  return created || left.id.localeCompare(right.id);
}

export function buildFinalTable(
  graph: Graph,
  masters: LayerMaster[],
  keyLayoutTypes: KeyLayoutType[],
  keyDrawingTypes: KeyDrawingType[],
): FinalTableData {
  const masterById = new Map(masters.map((master) => [master.id, master]));
  const layerById = new Map(graph.layers.map((layer) => [layer.id, layer]));
  const layoutNameById = new Map(keyLayoutTypes.map((layout) => [layout.id, layout.name]));
  const drawingById = new Map(keyDrawingTypes.map((drawing) => [drawing.id, drawing]));
  const masterForLayer = (layer: Layer | undefined) => (
    layer?.layer_master_id ? masterById.get(layer.layer_master_id) : undefined
  );
  const numberForLayer = (layer: Layer | undefined) => (
    formatLayerNumber(masterForLayer(layer)?.layer_number)
  );

  const layers = graph.layers
    .map((layer, index) => {
      const master = masterForLayer(layer);
      return {
        index,
        layerId: layer.id,
        number: formatLayerNumber(master?.layer_number),
        marker: openCloseMarker(master?.pr_open_close),
      };
    })
    .sort((left, right) => {
      const leftNumber = Number(left.number);
      const rightNumber = Number(right.number);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      if (left.number && !right.number) return -1;
      if (!left.number && right.number) return 1;
      return left.index - right.index;
    })
    .map(({ index: _index, ...layer }) => layer);

  const duplicateCounts = new Map<string, number>();
  const rows = graph.relations
    .filter((relation) => !relation.same_group && relation.parent_layer_id && relation.child_layer_id)
    .sort(relationOrder)
    .map((relation) => {
      const inner = numberForLayer(layerById.get(relation.parent_layer_id!));
      const outer = numberForLayer(layerById.get(relation.child_layer_id!));
      const pair = `${relation.parent_layer_id}\u0000${relation.child_layer_id}`;
      const count = (duplicateCounts.get(pair) ?? 0) + 1;
      duplicateCounts.set(pair, count);
      const baseName = inner && outer ? `${keyNumber(inner)}to${keyNumber(outer)}` : "";
      return {
        relation,
        keyName: baseName ? `${baseName}${count > 1 ? count : ""}` : "",
        keyLayoutType: relation.key_layout_type_id
          ? layoutNameById.get(relation.key_layout_type_id) ?? ""
          : "",
        keyDrawingType: relation.key_drawing_type_id
          ? drawingLabel(drawingById.get(relation.key_drawing_type_id))
          : "",
        inner,
        outer,
      };
    });

  return { layers, rows };
}

export function finalTableMatrix(
  table: FinalTableData,
  processNames: Record<string, string> = {},
  gdsNames: Record<string, string> = {},
  cellValues: Record<string, Record<string, string>> = {},
): Array<Array<string>> {
  const fixedHeaders = [
    "Key 이름",
    "기능별 Key",
    "Key Type",
    "No.",
    "Inner(아들자)",
    "Outer(어미자)",
    "Type",
    "key목적",
    "Placement",
    "Stack종류",
    "INREGI여부",
    "Inner Size",
    "Outer Size",
  ];
  const blankPrefix = Array.from({ length: fixedHeaders.length - 1 }, () => "");
  return [
    [...blankPrefix, "LAYER", ...table.layers.map((layer) => processNames[layer.layerId] ?? "")],
    [...blankPrefix, "STEP", ...table.layers.map((layer) => layer.number)],
    [...blankPrefix, "GDS", ...table.layers.map((layer) => gdsNames[layer.layerId] ?? "")],
    [...fixedHeaders, ...table.layers.map((layer) => layer.number)],
    ...table.rows.map((row) => [
      row.keyName,
      row.keyLayoutType,
      row.keyDrawingType,
      row.relation.key_priority ?? "",
      row.inner,
      row.outer,
      row.relation.final_type ?? "",
      row.relation.key_purpose ?? "",
      row.relation.placement ?? "",
      row.relation.stack_type ?? "",
      row.relation.inregi ?? "",
      row.relation.inner_size ?? "",
      row.relation.outer_size ?? "",
      ...table.layers.map((layer) => (
        Object.prototype.hasOwnProperty.call(cellValues[row.relation.id] ?? {}, layer.layerId)
          ? cellValues[row.relation.id][layer.layerId]
          : layer.marker
      )),
    ]),
  ];
}
