import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../api/client";
import { computeDisplayGraph, expandRelationCandidates, graphRestoreFromGraph, groupMaps } from "../domain/graph";
import type { Graph, RelationCreate } from "../types";
import { useAppStore } from "./app";
import { useProjectStore } from "./project";
import { useReferenceStore } from "./reference";

const HISTORY_LIMIT = 40;
const clone = <T>(value: T): T => structuredClone(value);

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
    if (next) reference.syncFromGraph(next);
  }

  function remember(previous: Graph | null) {
    if (!previous) return;
    undoStack.value = [...undoStack.value, previous].slice(-HISTORY_LIMIT);
    redoStack.value = [];
  }

  async function loadGraph(id = project.projectId) {
    if (!id) { setGraph(null); return }
    project.projectId = id;
    setGraph(await app.run("그래프 불러오기", () => api.getGraph(id)));
    undoStack.value = [];
    redoStack.value = [];
  }

  async function reloadGraph() {
    if (project.projectId) setGraph(await api.getGraph(project.projectId));
  }

  async function mutateGraph(label: string, job: () => Promise<Graph | unknown>, history = true) {
    if (!project.projectId) return;
    const previous = rawGraph.value ? clone(rawGraph.value) : null;
    const result = await app.run(label, job);
    const next = result && typeof result === "object" && "layers" in result ? result as Graph : await api.getGraph(project.projectId);
    if (history) remember(previous);
    setGraph(next);
  }

  async function createRelationExpanded(body: RelationCreate) {
    if (!project.projectId || !rawGraph.value) return;
    if (!body.parent_layer_id || !body.child_layer_id) {
      await mutateGraph("관계 생성", () => api.createRelation(project.projectId, body));
      return;
    }
    const candidates = expandRelationCandidates(rawGraph.value, body);
    if (!candidates.length) { app.status = "관계 생성: 중복 또는 self relation 제외"; return }
    const previous = clone(rawGraph.value);
    app.busy = true;
    app.status = `관계 ${candidates.length}개 생성...`;
    let completed = 0;
    try {
      for (const candidate of candidates) {
        await api.createRelation(project.projectId, candidate);
        completed += 1;
      }
      await reloadGraph();
      remember(previous);
      app.status = `관계 ${completed}개 생성 완료`;
    } catch (error) {
      await reloadGraph();
      app.status = `관계 ${completed}/${candidates.length}개 생성 후 실패: ${error instanceof Error ? error.message : String(error)}`;
      throw error;
    } finally {
      app.busy = false;
    }
  }

  async function undo() {
    if (!rawGraph.value || !undoStack.value.length || !project.projectId) return;
    const target = undoStack.value.at(-1)!;
    redoStack.value = [...redoStack.value, clone(rawGraph.value)].slice(-HISTORY_LIMIT);
    undoStack.value = undoStack.value.slice(0, -1);
    setGraph(await app.run("실행 취소", () => api.restoreGraph(project.projectId, graphRestoreFromGraph(target))));
  }

  async function redo() {
    if (!rawGraph.value || !redoStack.value.length || !project.projectId) return;
    const target = redoStack.value.at(-1)!;
    undoStack.value = [...undoStack.value, clone(rawGraph.value)].slice(-HISTORY_LIMIT);
    redoStack.value = redoStack.value.slice(0, -1);
    setGraph(await app.run("다시 실행", () => api.restoreGraph(project.projectId, graphRestoreFromGraph(target))));
  }

  return {
    rawGraph, displayGraph, undoStack, redoStack, anchorByLayerId, groupToLayerIds, groupSizeByLayerId,
    setGraph, loadGraph, reloadGraph, mutateGraph, createRelationExpanded, undo, redo,
  };
});
