import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { ApiError, api } from "../api/client";
import { cloneJson } from "../domain/clone";
import { computeDisplayGraph, expandRelationCandidates, graphRestoreFromGraph, groupMaps } from "../domain/graph";
import type { Graph, RelationCreate } from "../types";
import { useAppStore } from "./app";
import { useProjectStore } from "./project";
import { useReferenceStore } from "./reference";

const HISTORY_LIMIT = 40;
const clone = cloneJson;

export const useGraphStore = defineStore("graph", () => {
  const app = useAppStore();
  const project = useProjectStore();
  const reference = useReferenceStore();
  const rawGraph = ref<Graph | null>(null);
  const undoStack = ref<Graph[]>([]);
  const redoStack = ref<Graph[]>([]);

  const displayGraph = computed(() => rawGraph.value ? computeDisplayGraph(rawGraph.value) : null);
  const groupData = computed(() => rawGraph.value ? groupMaps(rawGraph.value) : { anchorByLayerId: {}, groupToLayerIds: {} });
  const anchorByLayerId = computed(() => groupData.value.anchorByLayerId);
  const groupToLayerIds = computed(() => groupData.value.groupToLayerIds);
  const groupSizeByLayerId = computed(() => Object.fromEntries(
    Object.values(groupToLayerIds.value).flatMap((ids) => ids.map((id) => [id, ids.length])),
  ));

  function setGraph(next: Graph | null) {
    rawGraph.value = next;
    if (next) {
      reference.syncFromGraph(next);
      if (next.align_tree) project.syncTree(next.align_tree);
    }
  }

  function resetGraph() {
    setGraph(null);
    undoStack.value = [];
    redoStack.value = [];
    app.clearSelection();
  }

  function remember(previous: Graph | null) {
    if (!previous) return;
    undoStack.value = [...undoStack.value, previous].slice(-HISTORY_LIMIT);
    redoStack.value = [];
  }

  async function loadGraph(id = project.projectId) {
    if (!id) { setGraph(null); return }
    const containerProjectId = project.currentProjectId;
    await project.activateTree(id);
    if (project.currentProjectId !== containerProjectId || project.projectId !== id) return;
    const loaded = await app.run("그래프 불러오기", () => api.getGraph(id));
    if (project.currentProjectId !== containerProjectId || project.projectId !== id) return;
    setGraph(loaded);
    undoStack.value = [];
    redoStack.value = [];
  }

  async function reloadGraph() {
    const containerProjectId = project.currentProjectId;
    const treeId = project.projectId;
    if (!treeId) return;
    const loaded = await api.getGraph(treeId);
    if (project.currentProjectId === containerProjectId && project.projectId === treeId) setGraph(loaded);
  }

  async function mutateGraph(label: string, job: () => Promise<Graph | unknown>, history = true) {
    if (!project.projectId) return;
    if (!project.canEdit) { app.status = project.readOnlyReason || "이 Align Tree는 보기 전용입니다."; return }
    const previous = rawGraph.value ? clone(rawGraph.value) : null;
    project.markSaving();
    try {
      const result = await app.run(label, job);
      const next = result && typeof result === "object" && "layers" in result ? result as Graph : await api.getGraph(project.projectId);
      if (history) remember(previous);
      setGraph(next);
      project.markSaved();
    } catch (error) {
      project.handleMutationError(error);
      if (error instanceof ApiError && error.status === 409) await reloadGraph();
      throw error;
    }
  }

  async function createRelationExpanded(body: RelationCreate) {
    if (!project.projectId || !rawGraph.value) return;
    if (!project.canEdit) { app.status = project.readOnlyReason || "이 Align Tree는 보기 전용입니다."; return }
    if (!body.parent_layer_id || !body.child_layer_id) {
      await mutateGraph("관계 생성", () => api.createRelation(project.projectId, body));
      return;
    }
    const candidates = expandRelationCandidates(rawGraph.value, body);
    if (!candidates.length) { app.status = "관계 생성: self relation 제외"; return }
    const previous = clone(rawGraph.value);
    app.busy = true;
    project.markSaving();
    app.status = `관계 ${candidates.length}개 생성...`;
    let completed = 0;
    try {
      for (const candidate of candidates) {
        await api.createRelation(project.projectId, candidate);
        completed += 1;
      }
      await reloadGraph();
      remember(previous);
      project.markSaved();
      app.status = `관계 ${completed}개 생성 완료`;
    } catch (error) {
      project.handleMutationError(error);
      await reloadGraph();
      app.status = `관계 ${completed}/${candidates.length}개 생성 후 실패: ${error instanceof Error ? error.message : String(error)}`;
      throw error;
    } finally {
      app.busy = false;
    }
  }

  async function undo() {
    if (!rawGraph.value || !undoStack.value.length || !project.projectId || !project.canEdit) return;
    const target = undoStack.value.at(-1)!;
    redoStack.value = [...redoStack.value, clone(rawGraph.value)].slice(-HISTORY_LIMIT);
    undoStack.value = undoStack.value.slice(0, -1);
    project.markSaving();
    setGraph(await app.run("실행 취소", () => api.restoreGraph(project.projectId, graphRestoreFromGraph(target))));
    project.markSaved();
  }

  async function redo() {
    if (!rawGraph.value || !redoStack.value.length || !project.projectId || !project.canEdit) return;
    const target = redoStack.value.at(-1)!;
    undoStack.value = [...undoStack.value, clone(rawGraph.value)].slice(-HISTORY_LIMIT);
    redoStack.value = redoStack.value.slice(0, -1);
    project.markSaving();
    setGraph(await app.run("다시 실행", () => api.restoreGraph(project.projectId, graphRestoreFromGraph(target))));
    project.markSaved();
  }

  async function deleteSelection() {
    if (!project.projectId || !app.selection.length || !project.canEdit) return;
    const selected = [...app.selection];
    project.markSaving();
    try {
      for (const item of selected) {
        if (item.kind === "layer") {
          const preview = await api.deletePreview(project.projectId, item.id);
          const relationCount = preview.incoming.length + preview.outgoing.length;
          if (relationCount && !confirm(`연결 관계 ${relationCount}개와 함께 삭제할까요?`)) continue;
          await api.deleteLayer(project.projectId, item.id);
        } else if (item.kind === "relation") {
          await api.deleteRelation(project.projectId, item.id);
        } else {
          await api.deleteText(project.projectId, item.id);
        }
      }
      app.clearSelection();
      await reloadGraph();
      project.markSaved();
    } catch (error) {
      project.handleMutationError(error);
      throw error;
    }
  }

  project.registerWorkspaceReset(resetGraph);

  return {
    rawGraph, displayGraph, undoStack, redoStack, anchorByLayerId, groupToLayerIds, groupSizeByLayerId,
    setGraph, resetGraph, loadGraph, reloadGraph, mutateGraph, createRelationExpanded, undo, redo, deleteSelection,
  };
});
