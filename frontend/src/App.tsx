import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api/client";
import CanvasEditor from "./components/CanvasEditor";
import LayerList from "./components/LayerList";
import PropertyPanel from "./components/PropertyPanel";
import Toolbar from "./components/Toolbar";
import type { EditorMode, Graph, Project, SelectionItem } from "./types";

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

  const createProject = async () => {
    setBusy(true);
    try {
      const project = await api.createProject({ name: `RIC Project ${projects.length + 1}` });
      setProjects((current) => [project, ...current]);
      setProjectId(project.id);
      setSelection([]);
      setStatus("Project created");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create project");
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

  return (
    <main className="app-shell">
      <Toolbar
        mode={mode}
        busy={busy}
        status={status}
        projectId={projectId}
        projects={projects}
        selectedProject={selectedProject}
        onProjectChange={setProjectId}
        onCreateProject={createProject}
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
    </main>
  );
}
