import type { GridColumn } from "../components/grid/SpreadsheetGrid.vue";
import type { BoxPreset, KeyLayoutType, LayerMaster, LayerMasterCreate } from "../types";

export type LayerMasterGridRow = Record<string, unknown>;

export function layerMasterMatchesQuery(master: Pick<LayerMaster, "name" | "layer_number">, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return master.name.toLowerCase().includes(needle)
    || (master.layer_number ?? "").toLowerCase().includes(needle);
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
