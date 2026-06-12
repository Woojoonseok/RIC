import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api/client";
import CanvasEditor from "./components/CanvasEditor";
import ExportView from "./components/ExportView";
import HomeView from "./components/HomeView";
import ImportView from "./components/ImportView";
import LayerList from "./components/LayerList";
import PropertyPanel from "./components/PropertyPanel";
import Toolbar from "./components/Toolbar";
import type { EditorMode, Graph, Project, SelectionItem } from "./types";

type AppView = "home" | "import" | "editor" | "export";

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

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const [mode, setMode] = useState<EditorMode>("select");
  const [view, setView] = useState<AppView>("home");
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects]
  );

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

  const mutateGraph = async (operation: () => Promise<unknown>, message: string) => {
    if (!projectId) {
      return;
    }
    setBusy(true);
    try {
      await operation();
      await loadGraph(projectId);
      setStatus(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };

  const createLayer = (x = 120, y = 120) =>
    mutateGraph(
      () =>
        api.createLayer(projectId, {
          name: `Layer ${((graph?.layers.length ?? 0) + 1).toString().padStart(2, "0")}`,
          x,
          y
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

  const onSelectItem = (item: SelectionItem, additive = false) => {
    setSelection((current) => applySelection(current, item, additive));
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
            relation.relation_type
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
    const layers = graph.layers
      .map((layer) => {
        const layout = layoutById.get(layer.id);
        const style = styleById.get(layer.id);
        if (!layout) return "";
        return `<rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="6" fill="${style?.fill_color ?? "#fff"}" stroke="${style?.stroke_color ?? "#2563eb"}"/><text x="${layout.x + layout.width / 2}" y="${layout.y + layout.height / 2 + 5}" text-anchor="middle" font-size="${style?.font_size ?? 14}" fill="${style?.text_color ?? "#111827"}">${layer.name}</text>`;
      })
      .join("");
    const relationLines = graph.relations
      .map((relation) => {
        const a = layoutById.get(relation.parent_layer_id);
        const b = layoutById.get(relation.child_layer_id);
        if (!a || !b) return "";
        return `<line x1="${a.x + a.width}" y1="${a.y + a.height / 2}" x2="${b.x}" y2="${b.y + b.height / 2}" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>`;
      })
      .join("");
    downloadBlob(
      `${graph.project.name}_ppt_image.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M 1 1 L 11 6 L 1 11 z" fill="#334155"/></marker></defs>${relationLines}${layers}</svg>`,
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
          onImportLayers={(rows) => void importLayers(rows)}
          onImportRelations={(rows) => void importRelations(rows)}
          onValidate={() => void mutateGraph(() => api.validate(projectId), "Validation executed")}
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
        projects={projects}
        selectedProject={selectedProject}
        onProjectChange={setProjectId}
        onCreateProject={() => void createProject()}
        onModeChange={setMode}
        onCreateLayer={() => void createLayer()}
        onCreateTextBox={() => void createTextBox()}
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
          onModeChange={setMode}
          onSelectionChange={setSelection}
          onSelectItem={onSelectItem}
          onCreateLayer={(x, y) => void createLayer(x, y)}
          onCreateTextBox={(x, y) => void createTextBox(x, y)}
          onUpdateLayout={(layerId, payload) =>
            mutateGraph(() => api.updateLayout(projectId, layerId, payload), "Layout saved")
          }
          onUpdateTextBox={(textBoxId, payload) =>
            mutateGraph(() => api.updateTextBox(projectId, textBoxId, payload), "Text box saved")
          }
          onCreateRelation={(payload) =>
            mutateGraph(() => api.createRelation(projectId, payload), "Relation added")
          }
        />
        <PropertyPanel
          graph={graph}
          selection={selection}
          onSelectionChange={setSelection}
          onUpdateLayer={(layerId, payload) =>
            mutateGraph(() => api.updateLayer(projectId, layerId, payload), "Layer saved")
          }
          onUpdateStyle={(layerId, payload) =>
            mutateGraph(() => api.updateStyle(projectId, layerId, payload), "Style saved")
          }
          onUpdateLayout={(layerId, payload) =>
            mutateGraph(() => api.updateLayout(projectId, layerId, payload), "Layout saved")
          }
          onUpdateRelation={(relationId, payload) =>
            mutateGraph(() => api.updateRelation(projectId, relationId, payload), "Relation saved")
          }
          onUpdateTextBox={(textBoxId, payload) =>
            mutateGraph(() => api.updateTextBox(projectId, textBoxId, payload), "Text box saved")
          }
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
