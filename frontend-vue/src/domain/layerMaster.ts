import type { GridColumn } from "../components/grid/SpreadsheetGrid.vue";
import type { BoxPreset, KeyLayoutType, Layer, LayerMaster, LayerMasterCreate, Layout, Point } from "../types";

export type LayerMasterGridRow = Record<string, unknown>;

export function layerMasterRowMatchesQuery(row: LayerMasterGridRow, columns: GridColumn[], query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("ko");
  if (!needle) return true;
  return columns.some((column) => String(row[column.key] ?? "").toLocaleLowerCase("ko").includes(needle));
}

export function filterLayerMasterRows(
  rows: LayerMasterGridRow[],
  columns: GridColumn[],
  query: string,
  filters: Record<string, string[]> = {},
  excludedFilterKey?: string,
): LayerMasterGridRow[] {
  return rows.filter((row) => (
    layerMasterRowMatchesQuery(row, columns, query)
    && Object.entries(filters).every(([key, selected]) => (
      key === excludedFilterKey || selected.includes(String(row[key] ?? ""))
    ))
  ));
}

export function layerMasterMatchesQuery(master: Pick<LayerMaster, "name" | "layer_number">, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return master.name.toLowerCase().includes(needle)
    || (master.layer_number ?? "").toLowerCase().includes(needle);
}

export function layerImportPositions(
  layers: Pick<Layer, "id" | "created_at" | "updated_at">[],
  layouts: Pick<Layout, "layer_id" | "x" | "y" | "width" | "height">[],
  count: number,
  preferredLayerId?: string,
  importedSize: Pick<Layout, "width" | "height"> = { width: 180, height: 72 },
  extraObstacles: Array<Pick<Layout, "x" | "y" | "width" | "height">> = [],
  lastActivity?: Point | null,
): Point[] {
  const layoutByLayerId = new Map(layouts.map((layout) => [layout.layer_id, layout]));
  let anchor: Pick<Layout, "x" | "y" | "width" | "height"> | undefined = preferredLayerId
    ? layoutByLayerId.get(preferredLayerId)
    : undefined;
  let anchorTime = Number.NEGATIVE_INFINITY;

  for (const layer of anchor ? [] : layers) {
    const layout = layoutByLayerId.get(layer.id);
    if (!layout) continue;
    const parsedTime = Date.parse(layer.updated_at || layer.created_at || "");
    const time = Number.isFinite(parsedTime) ? parsedTime : Number.NEGATIVE_INFINITY;
    if (!anchor || time >= anchorTime) {
      anchor = layout;
      anchorTime = time;
    }
  }

  const overlapOffset = 28;
  const margin = 16;
  const stackWidth = importedSize.width + Math.max(0, count - 1) * overlapOffset;
  const stackHeight = importedSize.height + Math.max(0, count - 1) * overlapOffset;
  const obstacles = [...layouts, ...extraObstacles];
  const preferredStart = lastActivity
    ? { x: lastActivity.x + 32, y: lastActivity.y + 32 }
    : anchor
      ? { x: anchor.x + anchor.width + 32, y: anchor.y }
      : { x: 120, y: 100 };
  const isOpen = (point: Point) => obstacles.every((obstacle) => (
    point.x + stackWidth + margin <= obstacle.x
    || point.x >= obstacle.x + obstacle.width + margin
    || point.y + stackHeight + margin <= obstacle.y
    || point.y >= obstacle.y + obstacle.height + margin
  ));

  let start = preferredStart;
  const searchStep = 40;
  for (let radius = 0; radius <= 80; radius += 1) {
    const offsets: Point[] = [];
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (Math.max(Math.abs(x), Math.abs(y)) === radius) offsets.push({ x, y });
      }
    }
    offsets.sort((left, right) => {
      const leftDistance = Math.hypot(left.x, left.y);
      const rightDistance = Math.hypot(right.x, right.y);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      if ((left.y >= 0) !== (right.y >= 0)) return left.y >= 0 ? -1 : 1;
      return right.x - left.x;
    });
    const found = offsets
      .map((offset) => ({
        x: Math.max(20, preferredStart.x + offset.x * searchStep),
        y: Math.max(20, preferredStart.y + offset.y * searchStep),
      }))
      .find(isOpen);
    if (found) {
      start = found;
      break;
    }
  }

  if (!isOpen(start)) {
    start = {
      x: Math.max(120, ...obstacles.map((obstacle) => obstacle.x + obstacle.width + margin)),
      y: Math.max(20, preferredStart.y),
    };
  }
  return Array.from({ length: Math.max(0, count) }, (_unused, index) => ({
    x: start.x + index * overlapOffset,
    y: start.y + index * overlapOffset,
  }));
}

function baseColumns(presets: BoxPreset[]): GridColumn[] {
  const defaultPreset = presets.find((preset) => preset.is_default) ?? presets[0];
  return [
    { key: "name", label: "Layer 명", width: 180 },
    { key: "layer_number", label: "Layer 번호", width: 120 },
    { key: "mask_main_fld", label: "Mask MAIN FLD", width: 140 },
    { key: "mask_sl_fld", label: "Mask SL FLD", width: 130 },
    { key: "pr_wf", label: "Mask PR", width: 110 },
    { key: "dev_wf", label: "WF Dev", width: 110 },
    { key: "pr_type", label: "WF PR종류", width: 120 },
    {
      key: "light_source",
      label: "광원",
      width: 150,
      options: presets.map((preset) => ({ value: preset.name, label: preset.is_default ? `${preset.name} (기본)` : preset.name })),
      defaultValue: defaultPreset?.name ?? "",
    },
    {
      key: "pr_open_close",
      label: "PR Open/Close",
      width: 130,
      options: [
        { value: "", label: "선택 안 함" },
        { value: "Open", label: "Open (O)" },
        { value: "Close", label: "Close (X)" },
      ],
    },
    { key: "group", label: "Group", width: 130 },
    { key: "validation_rule", label: "검증 Rule", width: 180 },
    { key: "comment", label: "Comment", width: 220 },
  ];
}

export function layerMasterBaseColumns(presets: BoxPreset[]): GridColumn[] {
  return [
    ...baseColumns(presets),
    { key: "priority_summary", label: "Key 우선순위", width: 150, readonly: true, action: true },
  ];
}

export function layerMasterPriorityColumns(layouts: KeyLayoutType[]): GridColumn[] {
  return [
    { key: "layer_number", label: "Layer 번호", width: 120, readonly: true, sticky: true },
    { key: "name", label: "Layer 명", width: 180, readonly: true, sticky: true },
    ...layouts.map((layout) => ({
      key: `priority:${layout.id}`,
      label: layout.name,
      width: 145,
      highlightEmpty: true,
    })),
  ];
}

export function layerMasterColumns(layouts: KeyLayoutType[], presets: BoxPreset[]): GridColumn[] {
  const basic = baseColumns(presets);
  return [
    ...basic.slice(0, 9),
    ...layouts.map((layout) => ({ key: `priority:${layout.id}`, label: `우선순위 ${layout.name}`, width: 145 })),
    ...basic.slice(9),
  ];
}

export function layerMasterRows(masters: LayerMaster[], layouts: KeyLayoutType[], presets: BoxPreset[]): LayerMasterGridRow[] {
  const defaultPreset = presets.find((preset) => preset.is_default) ?? presets[0];
  return masters.map((master) => ({
    ...master,
    group: master.group ?? "",
    light_source: master.light_source || defaultPreset?.name || "",
    ...Object.fromEntries(layouts.map((layout) => [`priority:${layout.id}`, master.priorities[layout.id] ?? ""])),
    priority_summary: `${layouts.filter((layout) => String(master.priorities[layout.id] ?? "").trim()).length}/${layouts.length} 설정`,
  }));
}

export function layerMasterPayload(row: LayerMasterGridRow, layouts: KeyLayoutType[]): LayerMasterCreate {
  const text = (key: string) => String(row[key] || "") || null;
  return {
    name: String(row.name || "").trim(),
    layer_number: String(row.layer_number || "").trim(),
    mask_main_fld: text("mask_main_fld"),
    mask_sl_fld: text("mask_sl_fld"),
    pr_wf: text("pr_wf"),
    dev_wf: text("dev_wf"),
    pr_type: text("pr_type"),
    light_source: text("light_source"),
    pr_open_close: text("pr_open_close"),
    group: text("group"),
    validation_rule: text("validation_rule"),
    comment: text("comment"),
    priorities: Object.fromEntries(layouts.map((layout) => [layout.id, text(`priority:${layout.id}`)])),
  };
}
