import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api/client";
import CanvasEditor from "./components/CanvasEditor";
import ExportView from "./components/ExportView";
import HomeView from "./components/HomeView";
import ImportView from "./components/ImportView";
import LayerList from "./components/LayerList";
import PropertyPanel from "./components/PropertyPanel";
import Toolbar from "./components/Toolbar";
import type { BoxPreset, EditorMode, Graph, GraphBatchUpdate, Layout, Project, SelectionItem, ShapeStyle, TextBox } from "./types";

type AppView = "home" | "import" | "editor" | "export";
const HISTORY_LIMIT = 40;

const SAMPLE_LAYERS = [
  { step: "S01", name: "WL", layer_property: "Main", align: "AA01", align_side: "LEFT" },
  { step: "S02", name: "BL", layer_property: "Sub", align: "AA02", align_side: "RIGHT" },
  { step: "S03", name: "CONTACT", layer_property: "Contact", align: "AA03", align_side: "CENTER" },
  { step: "S04", name: "METAL", layer_property: "Route", align: "AA04", align_side: "LEFT" }
];

const SAMPLE_RELATIONS = [
  ["WL", "BL", "Align"],
  ["BL", "CONTACT", "Overlay"],
  ["CONTACT", "METAL", "Align"]
];

function nextUniqueName(existingNames: string[], prefix: string) {
  const used = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  let index = existingNames.length + 1;
  let candidate = `${prefix} ${index.toString().padStart(2, "0")}`;
  while (used.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${prefix} ${index.toString().padStart(2, "0")}`;
  }
  return candidate;
}

function sameSelection(a: SelectionItem, b: SelectionItem) {
  return a.kind === b.kind && a.id === b.id;
}

function applySelection(selection: SelectionItem[], item: SelectionItem, additive: boolean) {
  if (!additive) {
    return [item];
  }
  return selection.some((selected) => sameSelection(selected, item))
    ? selection.filter((selected) => !sameSelection(selected, item))
    : [...selection, item];
}

function cloneGraph(graph: Graph): Graph {
  return JSON.parse(JSON.stringify(graph)) as Graph;
}

function isMergedLayer(layer: Graph["layers"][number] | null | undefined) {
  if (!layer) return false;
  const metadata = layer.metadata_json ?? {};
  return Array.isArray(metadata.merged_layers) || Array.isArray(metadata.merged_layer_names) || layer.name.includes("\n");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function multilineSvgText(value: string, x: number, centerY: number, fontSize: number) {
  const lines = value.split(/\r?\n/);
  const lineHeight = fontSize * 1.2;
  const firstY = centerY - ((lines.length - 1) * lineHeight) / 2 + fontSize / 3;
  return lines
    .map((line, index) => `<tspan x="${x}" y="${index === 0 ? firstY : firstY + index * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
}

function portPoint(layout: Layout, port: string) {
  if (port === "top") return { x: layout.x + layout.width / 2, y: layout.y };
  if (port === "bottom") return { x: layout.x + layout.width / 2, y: layout.y + layout.height };
  if (port === "left") return { x: layout.x, y: layout.y + layout.height / 2 };
  return { x: layout.x + layout.width, y: layout.y + layout.height / 2 };
}

function relationStroke(style?: Graph["relation_styles"][number], fallbackType = "") {
  if (style) {
    const dash =
      style.line_pattern === "dashed"
        ? "8 6"
        : style.line_pattern === "dotted"
          ? "2 6"
          : style.line_pattern === "reference"
            ? "10 4 2 4"
            : undefined;
    return {
      stroke: style.stroke_color,
      strokeWidth: style.stroke_width,
      strokeDasharray: dash,
      marker: style.marker_type === "arrow"
    };
  }
  const normalized = fallbackType.toLowerCase();
  if (normalized === "reference") return { stroke: "#7c3aed", strokeWidth: 2, strokeDasharray: "10 4 2 4", marker: true };
  if (normalized === "optional" || normalized === "warning") return { stroke: "#0891b2", strokeWidth: 2, strokeDasharray: "2 5", marker: true };
  if (normalized === "overlay") return { stroke: "#f97316", strokeWidth: 2, strokeDasharray: undefined, marker: true };
  return { stroke: "#334155", strokeWidth: 2, strokeDasharray: undefined, marker: true };
}

function fallbackArrowId(type: string) {
  const normalized = type.toLowerCase();
  if (normalized === "reference") return "reference";
  if (normalized === "optional" || normalized === "warning") return "optional";
  if (normalized === "overlay") return "overlay";
  return "default";
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [mode, setMode] = useState<EditorMode>("select");
  const [view, setView] = useState<AppView>("home");
  const [selectedRelationStyleId, setSelectedRelationStyleId] = useState("");
  const [selectedBoxPresetId, setSelectedBoxPresetId] = useState("");
  const [undoStack, setUndoStack] = useState<Graph[]>([]);
  const [redoStack, setRedoStack] = useState<Graph[]>([]);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects]
  );
  const selectedLayerIds = useMemo(
    () => selection.filter((item) => item.kind === "layer").map((item) => item.id),
    [selection]
  );
  const selectedSplitLayerId = useMemo(() => {
    if (!graph || selectedLayerIds.length !== 1) return "";
    const layer = graph.layers.find((item) => item.id === selectedLayerIds[0]);
    return layer && isMergedLayer(layer) ? layer.id : "";
  }, [graph, selectedLayerIds]);

  const rememberUndo = (snapshot: Graph | null) => {
    if (!snapshot) return;
    setUndoStack((current) => [...current, cloneGraph(snapshot)].slice(-HISTORY_LIMIT));
    setRedoStack([]);
  };

  const loadProjects = useCallback(async () => {
    const list = await api.listProjects();
    setProjects(list);
    if (!projectId && list.length > 0) {
      setProjectId(list[0].id);
    }
  }, [projectId]);

  const loadGraph = useCallback(
    async (id = projectId) => {
      if (!id) {
        setGraph(null);
        return;
      }
      setBusy(true);
      try {
        const nextGraph = await api.getGraph(id);
        setGraph(nextGraph);
        setSelectedRelationStyleId((current) =>
          current && nextGraph.relation_styles.some((style) => style.id === current)
            ? current
            : nextGraph.relation_styles[0]?.id ?? ""
        );
        const boxPresets = nextGraph.box_presets ?? [];
        setSelectedBoxPresetId((current) =>
          current && boxPresets.some((preset) => preset.id === current)
            ? current
            : boxPresets.find((preset) => preset.is_default)?.id ?? boxPresets[0]?.id ?? ""
        );
        setStatus(nextGraph.validation.ok ? "Saved" : `${nextGraph.validation.issues.length} validation issue(s)`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to load graph");
      } finally {
        setBusy(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadGraph(projectId);
  }, [loadGraph, projectId]);

  useEffect(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, [projectId]);

  const createProject = async (name?: string) => {
    setBusy(true);
    try {
      const project = await api.createProject({ name: name?.trim() || `RIC Project ${projects.length + 1}` });
      setProjects((current) => [project, ...current]);
      setProjectId(project.id);
      setSelection([]);
      setStatus("Project created");
      return project;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create project");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const mutateGraph = async (operation: () => Promise<unknown>, message: string, trackHistory = true) => {
    if (!projectId) {
      return;
    }
    const snapshot = graph ? cloneGraph(graph) : null;
    setBusy(true);
    try {
      await operation();
      await loadGraph(projectId);
      if (trackHistory) rememberUndo(snapshot);
      setStatus(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };

  const mergeBatchIntoGraph = (current: Graph, payload: GraphBatchUpdate): Graph => ({
    ...current,
    layouts: current.layouts.map((layout) => {
      const update = payload.layouts?.find((item) => item.layer_id === layout.layer_id);
      return update ? { ...layout, ...update } : layout;
    }),
    styles: current.styles.map((style) => {
      const update = payload.styles?.find((item) => item.layer_id === style.layer_id);
      return update ? { ...style, ...update } : style;
    }),
    text_boxes: current.text_boxes.map((textBox) => {
      const update = payload.text_boxes?.find((item) => item.id === textBox.id);
      return update ? { ...textBox, ...update } : textBox;
    })
  });

  const saveGraphBatch = async (payload: GraphBatchUpdate, message: string) => {
    if (!projectId) return;
    const snapshot = graph ? cloneGraph(graph) : null;
    setGraph((current) => (current ? mergeBatchIntoGraph(current, payload) : current));
    setStatus("Saving...");
    try {
      const nextGraph = await api.batchUpdateGraph(projectId, payload);
      setGraph(nextGraph);
      rememberUndo(snapshot);
      setStatus(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Operation failed");
      await loadGraph(projectId);
    }
  };

  const saveLayout = (layerId: string, payload: Partial<Layout>) =>
    saveGraphBatch({ layouts: [{ layer_id: layerId, ...payload }] }, "Layout saved");

  const saveStyle = (layerId: string, payload: Partial<ShapeStyle>) =>
    saveGraphBatch({ styles: [{ layer_id: layerId, ...payload }] }, "Style saved");

  const saveTextBox = (textBoxId: string, payload: Partial<TextBox>) =>
    saveGraphBatch({ text_boxes: [{ id: textBoxId, ...payload }] }, "Text box saved");

  const saveStyleBatch = (layerIds: string[], payload: Partial<ShapeStyle>) =>
    saveGraphBatch({ styles: layerIds.map((layerId) => ({ layer_id: layerId, ...payload })) }, "Styles saved");

  const saveCanvasMove = (payload: GraphBatchUpdate) => saveGraphBatch(payload, "Layout saved");

  const createLayer = (x = 120, y = 120) =>
    mutateGraph(
      () =>
        api.createLayer(projectId, {
          name: nextUniqueName(graph?.layers.map((layer) => layer.name) ?? [], "Layer"),
          x,
          y,
          box_preset_id: selectedBoxPresetId || graph?.box_presets?.find((preset) => preset.is_default)?.id || null
        }),
      "Layer added"
    );

  const createTextBox = (x = 160, y = 160) =>
    mutateGraph(() => api.createTextBox(projectId, { text: "Text", x, y }), "Text box added");

  const addRelationRow = () => {
    if (!graph || graph.layers.length < 2) {
      setStatus("At least two layers are required");
      return;
    }
    void mutateGraph(
      () =>
        api.createRelation(projectId, {
          parent_layer_id: graph.layers[0].id,
          child_layer_id: graph.layers[1].id,
          relation_type: "Align",
          relation_style_id: selectedRelationStyleId || graph.relation_styles[0]?.id || null,
          source_port: "right",
          target_port: "left"
        }),
      "Relation added"
    );
  };

  const loadSample = async () => {
    const project = await createProject("Project_A");
    if (!project) return;
    setBusy(true);
    try {
      const createdLayers = [];
      for (const [index, layer] of SAMPLE_LAYERS.entries()) {
        createdLayers.push(await api.createLayer(project.id, { ...layer, x: 100 + index * 230, y: 120 }));
      }
      const byName = new Map(createdLayers.map((layer) => [layer.name, layer.id]));
      for (const [parent, child, type] of SAMPLE_RELATIONS) {
        const parentId = byName.get(parent);
        const childId = byName.get(child);
        if (parentId && childId) {
          await api.createRelation(project.id, {
            parent_layer_id: parentId,
            child_layer_id: childId,
            relation_type: type,
            relation_style_id: null,
            source_port: "right",
            target_port: "left"
          });
        }
      }
      await loadProjects();
      setProjectId(project.id);
      await loadGraph(project.id);
      setView("editor");
      setStatus("Sample loaded");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load sample");
    } finally {
      setBusy(false);
    }
  };

  const importLayers = (rows: Record<string, string>[]) =>
    mutateGraph(async () => {
      for (const [index, row] of rows.entries()) {
        await api.createLayer(projectId, {
          name: row.Layer || `Layer ${((graph?.layers.length ?? 0) + index + 1).toString().padStart(2, "0")}`,
          step: row.Step || null,
          layer_property: row.Layer_Property || null,
          align: row.Align || null,
          align_side: row.Align_side || null,
          x: 100 + index * 30,
          y: 100 + index * 30
        });
      }
    }, "Layer rows imported");

  const importRelations = (rows: Record<string, string>[]) =>
    mutateGraph(async () => {
      const currentGraph = await api.getGraph(projectId);
      const byName = new Map(currentGraph.layers.map((layer) => [layer.name.trim().toLowerCase(), layer.id]));
      const styleByName = new Map(currentGraph.relation_styles.map((style) => [style.name.trim().toLowerCase(), style.id]));
      for (const row of rows) {
        const parentId = byName.get((row.Parent_Layer || "").trim().toLowerCase());
        const childId = byName.get((row.Child_Layer || "").trim().toLowerCase());
        if (!parentId || !childId) {
          throw new Error(`Unknown layer in relation: ${row.Parent_Layer} -> ${row.Child_Layer}`);
        }
        await api.createRelation(projectId, {
          parent_layer_id: parentId,
          child_layer_id: childId,
          relation_type: row.Relation_Type || "Align",
          relation_style_id: styleByName.get((row.Relation_Type || "").trim().toLowerCase()) ?? currentGraph.relation_styles[0]?.id ?? null,
          source_port: "right",
          target_port: "left"
        });
      }
    }, "Relation rows imported");

  const deleteSelection = async () => {
    if (!graph || selection.length === 0) {
      return;
    }

    const layerIds = selection.filter((item) => item.kind === "layer").map((item) => item.id);
    for (const layerId of layerIds) {
      const preview = await api.previewDeleteLayer(projectId, layerId);
      const total = preview.incoming.length + preview.outgoing.length;
      if (total > 0) {
        const confirmed = window.confirm(`This layer has ${total} relation(s). Delete the layer and its relations?`);
        if (!confirmed) {
          return;
        }
      }
    }

    await mutateGraph(async () => {
      for (const item of selection) {
        if (item.kind === "layer") {
          await api.deleteLayer(projectId, item.id);
        }
        if (item.kind === "relation") {
          await api.deleteRelation(projectId, item.id);
        }
        if (item.kind === "text") {
          await api.deleteTextBox(projectId, item.id);
        }
      }
      setSelection([]);
    }, "Deleted");
  };

  const mergeSelectedLayers = async () => {
    if (!projectId || !graph) return;
    if (selectedLayerIds.length < 2) {
      setStatus("Select at least two layers to merge");
      return;
    }
    const selectedLayers = selectedLayerIds
      .map((id) => graph.layers.find((layer) => layer.id === id))
      .filter(Boolean);
    const label = selectedLayers.map((layer) => layer!.name).join(", ");
    const confirmed = window.confirm(
      `Merge ${selectedLayerIds.length} layers into one Layer box?\n\n${label}\n\nThis rewires relations and removes the merged source layers.`
    );
    if (!confirmed) return;

    const snapshot = cloneGraph(graph);
    setBusy(true);
    try {
      const nextGraph = await api.mergeLayers(projectId, { layer_ids: selectedLayerIds });
      setGraph(nextGraph);
      setSelection([{ kind: "layer", id: selectedLayerIds[0] }]);
      rememberUndo(snapshot);
      setStatus("Layers merged");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Layer merge failed");
      await loadGraph(projectId);
    } finally {
      setBusy(false);
    }
  };

  const splitSelectedLayer = async () => {
    if (!projectId || !graph || !selectedSplitLayerId) {
      setStatus("Select one merged layer to split");
      return;
    }
    const selectedLayer = graph.layers.find((layer) => layer.id === selectedSplitLayerId);
    const confirmed = window.confirm(`Split '${selectedLayer?.name ?? "Layer"}' back into separate Layer boxes?`);
    if (!confirmed) return;

    const snapshot = cloneGraph(graph);
    setBusy(true);
    try {
      const nextGraph = await api.splitLayer(projectId, selectedSplitLayerId, { orientation: "vertical" });
      setGraph(nextGraph);
      setSelection([{ kind: "layer", id: selectedSplitLayerId }]);
      rememberUndo(snapshot);
      setStatus("Layer split");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Layer split failed");
      await loadGraph(projectId);
    } finally {
      setBusy(false);
    }
  };

  const applyRestoredGraph = (nextGraph: Graph) => {
    setGraph(nextGraph);
    setSelection([]);
    setSelectedRelationStyleId((current) =>
      current && nextGraph.relation_styles.some((style) => style.id === current)
        ? current
        : nextGraph.relation_styles[0]?.id ?? ""
    );
    const boxPresets = nextGraph.box_presets ?? [];
    setSelectedBoxPresetId((current) =>
      current && boxPresets.some((preset) => preset.id === current)
        ? current
        : boxPresets.find((preset) => preset.is_default)?.id ?? boxPresets[0]?.id ?? ""
    );
  };

  const undoGraph = async () => {
    if (!projectId || !graph || undoStack.length === 0) return;
    const target = undoStack[undoStack.length - 1];
    const current = cloneGraph(graph);
    setBusy(true);
    try {
      const restored = await api.restoreGraph(projectId, target);
      setUndoStack((stack) => stack.slice(0, -1));
      setRedoStack((stack) => [...stack, current].slice(-HISTORY_LIMIT));
      applyRestoredGraph(restored);
      setStatus("Undo");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Undo failed");
      await loadGraph(projectId);
    } finally {
      setBusy(false);
    }
  };

  const redoGraph = async () => {
    if (!projectId || !graph || redoStack.length === 0) return;
    const target = redoStack[redoStack.length - 1];
    const current = cloneGraph(graph);
    setBusy(true);
    try {
      const restored = await api.restoreGraph(projectId, target);
      setRedoStack((stack) => stack.slice(0, -1));
      setUndoStack((stack) => [...stack, current].slice(-HISTORY_LIMIT));
      applyRestoredGraph(restored);
      setStatus("Redo");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Redo failed");
      await loadGraph(projectId);
    } finally {
      setBusy(false);
    }
  };

  const onSelectItem = (item: SelectionItem, additive = false) => {
    setSelection((current) => applySelection(current, item, additive));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (event.shiftKey) void redoGraph();
        else void undoGraph();
      }
      if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        void redoGraph();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const createRelationStyle = () => {
    void mutateGraph(
      () =>
        api.createRelationStyle(projectId, {
          name: nextUniqueName(graph?.relation_styles.map((style) => style.name) ?? [], "Arrow"),
          stroke_color: "#111827",
          stroke_width: 2,
          line_pattern: "solid",
          marker_type: "arrow",
          sort_order: graph?.relation_styles.length ?? 0
        }),
      "Arrow style added"
    );
  };

  const createBoxPreset = () => {
    if (!projectId) return;
    void mutateGraph(
      () =>
        api.createBoxPreset(projectId, {
          name: nextUniqueName(graph?.box_presets?.map((preset) => preset.name) ?? [], "Box"),
          fill_color: "#dbeafe",
          stroke_color: "#2563eb",
          text_color: "#111827",
          font_size: 16,
          width: 180,
          height: 72,
          stroke_width: 2,
          is_default: !(graph?.box_presets?.length ?? 0),
          sort_order: graph?.box_presets?.length ?? 0
        }),
      "Box preset added"
    );
  };

  const updateBoxPreset = (presetId: string, payload: Partial<BoxPreset>) => {
    if (!projectId) return;
    void mutateGraph(() => api.updateBoxPreset(projectId, presetId, payload), "Box preset saved");
  };

  const deleteBoxPreset = (presetId: string) => {
    if (!projectId || !graph) return;
    const preset = graph.box_presets.find((item) => item.id === presetId);
    if (!preset) return;
    if (!window.confirm(`Delete box preset '${preset.name}'? Existing layers will not change.`)) return;
    void mutateGraph(() => api.deleteBoxPreset(projectId, presetId), "Box preset deleted");
  };

  const deleteRelationStyle = (styleId: string) => {
    if (!graph) return;
    const style = graph.relation_styles.find((item) => item.id === styleId);
    if (!style) return;
    const usedCount = graph.relations.filter((relation) => relation.relation_style_id === styleId).length;
    const confirmed = usedCount
      ? window.confirm(`Delete arrow style '${style.name}'? ${usedCount} relation(s) using it will fall back to default styling.`)
      : window.confirm(`Delete arrow style '${style.name}'?`);
    if (!confirmed) return;
    void mutateGraph(() => api.deleteRelationStyle(projectId, styleId), "Arrow style deleted");
  };

  const downloadBlob = (filename: string, body: string, type: string) => {
    const blob = new Blob([body], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const workbookHtml = (sheets: Record<string, string[][]>) =>
    `<html><head><meta charset="utf-8"></head><body>${Object.entries(sheets)
      .map(
        ([name, rows]) =>
          `<h2>${name}</h2><table border="1">${rows
            .map((row) => `<tr>${row.map((cell) => `<td>${String(cell ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</td>`).join("")}</tr>`)
            .join("")}</table>`
      )
      .join("")}</body></html>`;

  const downloadTemplate = () => {
    downloadBlob(
      "align_tree_template.xls",
      workbookHtml({
        Align_Input: [["Step", "Layer", "Layer_Property", "Align", "Align_side"], ["S01", "WL", "Main", "AA01", "LEFT"]],
        Layer_Relation: [["Parent_Layer", "Child_Layer", "Relation_Type"], ["WL", "BL", "Align"]]
      }),
      "application/vnd.ms-excel"
    );
  };

  const exportExcel = () => {
    if (!graph) return;
    const layerName = new Map(graph.layers.map((layer) => [layer.id, layer.name]));
    const relationStyleById = new Map(graph.relation_styles.map((style) => [style.id, style]));
    downloadBlob(
      `${graph.project.name}_align_tree.xls`,
      workbookHtml({
        Align_Input: [
          ["Step", "Layer", "Layer_Property", "Align", "Align_side"],
          ...graph.layers.map((layer) => [layer.step ?? "", layer.name, layer.layer_property ?? "", layer.align ?? "", layer.align_side ?? ""])
        ],
        Layer_Relation: [
          ["Parent_Layer", "Child_Layer", "Relation_Type"],
          ...graph.relations.map((relation) => [
            layerName.get(relation.parent_layer_id) ?? "",
            layerName.get(relation.child_layer_id) ?? "",
            (relation.relation_style_id ? relationStyleById.get(relation.relation_style_id)?.name : null) ?? relation.relation_type
          ])
        ],
        Validation_Result: [["Level", "Message"], ...graph.validation.issues.map((issue) => [issue.severity, issue.message])]
      }),
      "application/vnd.ms-excel"
    );
  };

  const exportSvg = () => {
    if (!graph) return;
    const layoutById = new Map(graph.layouts.map((layout) => [layout.layer_id, layout]));
    const styleById = new Map(graph.styles.map((style) => [style.layer_id, style]));
    const relationStyleById = new Map(graph.relation_styles.map((style) => [style.id, style]));
    const visibleLayouts = graph.layers
      .map((layer) => layoutById.get(layer.id))
      .filter((layout): layout is Layout => Boolean(layout));
    const minX = Math.min(0, ...visibleLayouts.map((layout) => layout.x)) - 80;
    const minY = Math.min(0, ...visibleLayouts.map((layout) => layout.y)) - 80;
    const maxX = Math.max(1600, ...visibleLayouts.map((layout) => layout.x + layout.width)) + 80;
    const maxY = Math.max(1000, ...visibleLayouts.map((layout) => layout.y + layout.height)) + 80;
    const markers = [
      ["default", "#334155"],
      ["reference", "#7c3aed"],
      ["optional", "#0891b2"],
      ["overlay", "#f97316"]
    ]
      .map(
        ([id, color]) =>
          `<marker id="arrow-${id}" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`
      )
      .join("");
    const styleMarkers = graph.relation_styles
      .map(
        (style) =>
          `<marker id="arrow-${style.id}" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${escapeXml(style.stroke_color)}"/></marker>`
      )
      .join("");
    const layers = graph.layers
      .map((layer) => {
        const layout = layoutById.get(layer.id);
        const style = styleById.get(layer.id);
        if (!layout) return "";
        const fontSize = style?.font_size ?? 14;
        const text = multilineSvgText(layer.name, layout.x + layout.width / 2, layout.y + layout.height / 2, fontSize);
        return `<rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="6" fill="${style?.fill_color ?? "#fff"}" stroke="${style?.stroke_color ?? "#2563eb"}" stroke-width="${style?.stroke_width ?? 2}"/><text text-anchor="middle" font-size="${fontSize}" fill="${style?.text_color ?? "#111827"}">${text}</text>`;
      })
      .join("");
    const relationLines = graph.relations
      .map((relation) => {
        const a = layoutById.get(relation.parent_layer_id);
        const b = layoutById.get(relation.child_layer_id);
        if (!a || !b) return "";
        const start = portPoint(a, relation.source_port);
        const end = portPoint(b, relation.target_port);
        const relationStyle = relation.relation_style_id ? relationStyleById.get(relation.relation_style_id) : undefined;
        const stroke = relationStroke(relationStyle, relation.relation_type);
        const dash = stroke.strokeDasharray ? ` stroke-dasharray="${stroke.strokeDasharray}"` : "";
        const marker = stroke.marker
          ? ` marker-end="url(#arrow-${relationStyle?.id ?? fallbackArrowId(relation.relation_type)})"`
          : "";
        return `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${stroke.stroke}" stroke-width="${stroke.strokeWidth}"${dash}${marker}/>`;
      })
      .join("");
    downloadBlob(
      `${graph.project.name}_ppt_image.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX - minX}" height="${maxY - minY}" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}"><defs>${markers}${styleMarkers}</defs>${relationLines}${layers}</svg>`,
      "image/svg+xml"
    );
  };

  const exportPptOutline = () => {
    if (!graph) return;
    const rows = graph.layers
      .map((layer) => `<li>${layer.step ?? ""} ${layer.name} - ${layer.align ?? ""} / ${layer.align_side ?? "-"}</li>`)
      .join("");
    downloadBlob(
      `${graph.project.name}_ppt_outline.ppt`,
      `<html><head><meta charset="utf-8"><title>${graph.project.name}</title></head><body><h1>${graph.project.name} Align Tree</h1><ul>${rows}</ul><p>Use PPT Image Export SVG as the slide image source.</p></body></html>`,
      "application/vnd.ms-powerpoint"
    );
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand">
          <strong>RIC</strong>
          <span>{selectedProject?.name ?? "No project loaded"}</span>
        </div>
        <nav className="tabs" aria-label="Views">
          {(["home", "import", "editor", "export"] as AppView[]).map((item) => (
            <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => setView(item)}>
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <div className="toolbar-status" data-busy={busy}>{busy ? "Saving..." : status}</div>
      </header>
      {view === "home" && (
        <HomeView
          projects={projects}
          currentProjectId={projectId}
          onOpenProject={(id) => {
            setProjectId(id);
            setView("editor");
          }}
          onCreateProject={(name) => void createProject(name)}
          onLoadSample={() => void loadSample()}
          onDownloadTemplate={downloadTemplate}
        />
      )}
      {view === "import" && (
        <ImportView
          graph={graph}
          selection={selection}
          onSelectLayer={(id, additive) => onSelectItem({ kind: "layer", id }, additive)}
          onSelectRelation={(id) => setSelection([{ kind: "relation", id }])}
          onAddLayer={() => void createLayer()}
          onAddRelation={addRelationRow}
          onUpdateLayer={(layerId, payload) => void mutateGraph(() => api.updateLayer(projectId, layerId, payload), "Layer saved")}
          onUpdateRelation={(relationId, payload) => void mutateGraph(() => api.updateRelation(projectId, relationId, payload), "Relation saved")}
          onCreateRelationStyle={createRelationStyle}
          onUpdateRelationStyle={(styleId, payload) =>
            void mutateGraph(() => api.updateRelationStyle(projectId, styleId, payload), "Arrow style saved")
          }
          onDeleteRelationStyle={deleteRelationStyle}
          onCreateBoxPreset={createBoxPreset}
          onUpdateBoxPreset={updateBoxPreset}
          onDeleteBoxPreset={deleteBoxPreset}
          onImportLayers={(rows) => void importLayers(rows)}
          onImportRelations={(rows) => void importRelations(rows)}
          onValidate={() => void mutateGraph(() => api.validate(projectId), "Validation executed", false)}
          onBuildTree={() => void mutateGraph(() => api.autoLayout(projectId), "Align tree built")}
        />
      )}
      {view === "editor" && (
        <section className="editor-view">
      <Toolbar
        mode={mode}
        busy={busy}
        status={status}
        projectId={projectId}
        relationStyles={graph?.relation_styles ?? []}
        selectedRelationStyleId={selectedRelationStyleId}
        boxPresets={graph?.box_presets ?? []}
        selectedBoxPresetId={selectedBoxPresetId}
        selectedLayerCount={selectedLayerIds.length}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        canSplitLayer={Boolean(selectedSplitLayerId)}
        onRelationStyleChange={setSelectedRelationStyleId}
        onBoxPresetChange={setSelectedBoxPresetId}
        onCreateRelationStyle={createRelationStyle}
        onModeChange={setMode}
        onCreateLayer={() => void createLayer()}
        onCreateTextBox={() => void createTextBox()}
        onMergeLayers={() => void mergeSelectedLayers()}
        onSplitLayer={() => void splitSelectedLayer()}
        onUndo={() => void undoGraph()}
        onRedo={() => void redoGraph()}
        onAutoLayout={() => mutateGraph(() => api.autoLayout(projectId), "Auto layout applied")}
        onDelete={() => void deleteSelection()}
        onRefresh={() => void loadGraph()}
      />
      <section className="workspace">
        <LayerList
          graph={graph}
          selection={selection}
          onSelect={(id, additive) => onSelectItem({ kind: "layer", id }, additive)}
        />
        <CanvasEditor
          graph={graph}
          selection={selection}
          mode={mode}
          selectedRelationStyleId={selectedRelationStyleId}
          onModeChange={setMode}
          onSelectionChange={setSelection}
          onSelectItem={onSelectItem}
          onCreateLayer={(x, y) => void createLayer(x, y)}
          onCreateTextBox={(x, y) => void createTextBox(x, y)}
          onUpdateLayout={saveLayout}
          onUpdateTextBox={saveTextBox}
          onUpdateBatch={saveCanvasMove}
          onCreateRelation={(payload) =>
            mutateGraph(() => api.createRelation(projectId, payload), "Relation added")
          }
        />
        <PropertyPanel
          graph={graph}
          selection={selection}
          canSplitLayer={Boolean(selectedSplitLayerId)}
          onSelectionChange={setSelection}
          onUpdateLayer={(layerId, payload) =>
            mutateGraph(() => api.updateLayer(projectId, layerId, payload), "Layer saved")
          }
          onUpdateStyle={(layerId, payload) =>
            saveStyle(layerId, payload)
          }
          onUpdateLayout={(layerId, payload) =>
            saveLayout(layerId, payload)
          }
          onUpdateRelation={(relationId, payload) =>
            mutateGraph(() => api.updateRelation(projectId, relationId, payload), "Relation saved")
          }
          onUpdateTextBox={(textBoxId, payload) =>
            saveTextBox(textBoxId, payload)
          }
          onUpdateStyles={saveStyleBatch}
          onMergeLayers={() => void mergeSelectedLayers()}
          onSplitLayer={() => void splitSelectedLayer()}
        />
      </section>
        </section>
      )}
      {view === "export" && (
        <ExportView
          graph={graph}
          onDownloadTemplate={downloadTemplate}
          onExportExcel={exportExcel}
          onExportSvg={exportSvg}
          onExportPpt={exportPptOutline}
        />
      )}
    </main>
  );
}
