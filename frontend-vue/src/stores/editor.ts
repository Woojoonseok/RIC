import { computed, ref } from "vue";
import { defineStore } from "pinia";

import { api } from "../api/client";
import { computeDisplayGraph, groupMaps } from "../domain/graph";
import type { AppView, EditorMode, Graph, Project, SelectionItem } from "../types";

const HISTORY_LIMIT = 40;
const clone = <T>(value: T): T => structuredClone(value);

export const useEditorStore = defineStore("editor", () => {
  const projects = ref<Project[]>([]);
  const projectId = ref("");
  const graph = ref<Graph | null>(null);
  const selection = ref<SelectionItem[]>([]);
  const mode = ref<EditorMode>("select");
  const view = ref<AppView>("home");
  const labelField = ref<"name" | "step">("name");
  const selectedRelationStyleId = ref("");
  const selectedBoxPresetId = ref("");
  const undoStack = ref<Graph[]>([]);
  const redoStack = ref<Graph[]>([]);
  const status = ref("준비");
  const busy = ref(false);
  const focusRequest = ref<{ layerId: string; nonce: number } | null>(null);
  const layerMasterPickerOpen = ref(false);

  const selectedProject = computed(() => projects.value.find((item) => item.id === projectId.value) ?? null);
  const selectedLayerIds = computed(() => selection.value.filter((item) => item.kind === "layer").map((item) => item.id));
  const selectedSplitLayerId = computed(() => selectedLayerIds.value.length === 1 ? selectedLayerIds.value[0] : null);
  const groupData = computed(() => graph.value ? groupMaps(graph.value) : { anchorByLayerId: {}, groupToLayerIds: {} });
  const anchorByLayerId = computed(() => groupData.value.anchorByLayerId);
  const groupToLayerIds = computed(() => groupData.value.groupToLayerIds);
  const groupSizeByLayerId = computed(() => Object.fromEntries(Object.values(groupToLayerIds.value).flatMap((ids) => ids.map((id) => [id, ids.length]))));
  const displayGraph = computed(() => graph.value ? computeDisplayGraph(graph.value) : null);

  function setGraph(next: Graph | null) {
    graph.value = next;
    if (next) {
      selectedRelationStyleId.value ||= next.relation_styles[0]?.id ?? "";
      selectedBoxPresetId.value ||= next.box_presets.find((row) => row.is_default)?.id ?? next.box_presets[0]?.id ?? "";
    }
  }
  async function run<T>(label: string, job: () => Promise<T>) {
    busy.value = true;
    status.value = `${label}...`;
    try { const result = await job(); status.value = `${label} 완료`; return result }
    catch (error) { status.value = error instanceof Error ? error.message : String(error); throw error }
    finally { busy.value = false }
  }
  async function loadProjects() { projects.value = await run("프로젝트 불러오기", api.listProjects) }
  async function loadGraph(id = projectId.value) {
    if (!id) { setGraph(null); return }
    projectId.value = id;
    setGraph(await run("그래프 불러오기", () => api.getGraph(id)));
    undoStack.value = []; redoStack.value = [];
  }
  async function mutateGraph(label: string, job: () => Promise<Graph | unknown>, history = true) {
    if (!projectId.value) return;
    const previous = graph.value ? clone(graph.value) : null;
    const result = await run(label, job);
    const next = result && typeof result === "object" && "layers" in result ? result as Graph : await api.getGraph(projectId.value);
    if (history && previous) {
      undoStack.value = [...undoStack.value, previous].slice(-HISTORY_LIMIT);
      redoStack.value = [];
    }
    setGraph(next);
  }
  async function undo() {
    if (!graph.value || !undoStack.value.length) return;
    const target = undoStack.value.at(-1)!;
    redoStack.value = [...redoStack.value, clone(graph.value)].slice(-HISTORY_LIMIT);
    undoStack.value = undoStack.value.slice(0, -1);
    setGraph(await run("실행 취소", () => api.restoreGraph(projectId.value, target)));
  }
  async function redo() {
    if (!graph.value || !redoStack.value.length) return;
    const target = redoStack.value.at(-1)!;
    undoStack.value = [...undoStack.value, clone(graph.value)].slice(-HISTORY_LIMIT);
    redoStack.value = redoStack.value.slice(0, -1);
    setGraph(await run("다시 실행", () => api.restoreGraph(projectId.value, target)));
  }
  function select(item: SelectionItem, additive = false) {
    if (!additive) selection.value = [item];
    else if (selection.value.some((row) => row.kind === item.kind && row.id === item.id)) selection.value = selection.value.filter((row) => row.kind !== item.kind || row.id !== item.id);
    else selection.value = [...selection.value, item];
  }

  return {
    projects, projectId, graph, selection, mode, view, labelField, selectedRelationStyleId, selectedBoxPresetId,
    undoStack, redoStack, status, busy, focusRequest, layerMasterPickerOpen, selectedProject, selectedLayerIds,
    selectedSplitLayerId, anchorByLayerId, groupToLayerIds, groupSizeByLayerId, displayGraph,
    setGraph, run, loadProjects, loadGraph, mutateGraph, undo, redo, select,
  };
});
