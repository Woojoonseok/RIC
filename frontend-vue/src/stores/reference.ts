import { ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../api/client";
import type {
  BoxPreset, Graph, KeyDrawingType, KeyLayoutType, KeyShape, LayerMaster, ReferenceReadMap,
  ReferenceResource, RelationStyle,
} from "../types";
import { useProjectStore } from "./project";

export const useReferenceStore = defineStore("reference", () => {
  const keyLayoutTypes = ref<KeyLayoutType[]>([]);
  const keyDrawingTypes = ref<KeyDrawingType[]>([]);
  const keyShapes = ref<KeyShape[]>([]);
  const relationStyles = ref<RelationStyle[]>([]);
  const boxPresets = ref<BoxPreset[]>([]);
  const layerMasters = ref<LayerMaster[]>([]);
  const selectedRelationStyleId = ref("");
  const selectedBoxPresetId = ref("");
  let loadNonce = 0;
  let pendingLoad: { projectId: string; promise: Promise<boolean> } | null = null;

  function replaceById<T extends { id: string }>(rows: T[], row: T) {
    const index = rows.findIndex((item) => item.id === row.id);
    return index < 0 ? [...rows, row] : rows.map((item, itemIndex) => itemIndex === index ? row : item);
  }

  function syncReferenceRow<K extends ReferenceResource>(resource: K, row: ReferenceReadMap[K]) {
    if (resource === "key-layout-types") {
      keyLayoutTypes.value = replaceById(keyLayoutTypes.value, row as KeyLayoutType);
    } else if (resource === "key-drawing-types") {
      keyDrawingTypes.value = replaceById(keyDrawingTypes.value, row as KeyDrawingType);
    } else if (resource === "key-shapes") {
      keyShapes.value = replaceById(keyShapes.value, row as KeyShape);
    } else if (resource === "relation-styles") {
      relationStyles.value = replaceById(relationStyles.value, row as RelationStyle);
    } else {
      const preset = row as BoxPreset;
      boxPresets.value = replaceById(
        preset.is_default ? boxPresets.value.map((item) => ({ ...item, is_default: item.id === preset.id })) : boxPresets.value,
        preset,
      );
    }
  }

  function removeReferenceRow(resource: ReferenceResource, id: string) {
    if (resource === "key-layout-types") keyLayoutTypes.value = keyLayoutTypes.value.filter((row) => row.id !== id);
    else if (resource === "key-drawing-types") keyDrawingTypes.value = keyDrawingTypes.value.filter((row) => row.id !== id);
    else if (resource === "key-shapes") keyShapes.value = keyShapes.value.filter((row) => row.id !== id);
    else if (resource === "relation-styles") relationStyles.value = relationStyles.value.filter((row) => row.id !== id);
    else boxPresets.value = boxPresets.value.filter((row) => row.id !== id);
  }

  function syncLayerMaster(row: LayerMaster) {
    const index = layerMasters.value.findIndex((item) => item.id === row.id);
    layerMasters.value = index < 0
      ? [...layerMasters.value, row]
      : layerMasters.value.map((item, itemIndex) => itemIndex === index ? row : item);
  }

  function removeLayerMasters(ids: string[]) {
    const removed = new Set(ids);
    layerMasters.value = layerMasters.value.filter((row) => !removed.has(row.id));
  }

  function syncFromGraph(graph: Graph) {
    relationStyles.value = graph.relation_styles;
    boxPresets.value = graph.box_presets;
    if (!graph.relation_styles.some((row) => row.id === selectedRelationStyleId.value)) {
      selectedRelationStyleId.value = graph.relation_styles[0]?.id ?? "";
    }
    if (!graph.box_presets.some((row) => row.id === selectedBoxPresetId.value)) {
      selectedBoxPresetId.value = graph.box_presets.find((row) => row.is_default)?.id ?? graph.box_presets[0]?.id ?? "";
    }
  }

  async function loadAll() {
    const project = useProjectStore();
    const projectId = project.currentProjectId;
    if (pendingLoad?.projectId === projectId) return pendingLoad.promise;
    const nonce = ++loadNonce;
    const promise = (async () => {
      const [layouts, drawings, shapes, styles, presets, masters] = await Promise.all([
        api.keyLayoutTypes(), api.keyDrawingTypes(), api.keyShapes(), api.relationStyles(), api.boxPresets(), api.layerMasters(),
      ]);
      if (nonce !== loadNonce || project.currentProjectId !== projectId) return false;
      keyLayoutTypes.value = layouts;
      keyDrawingTypes.value = drawings;
      keyShapes.value = shapes;
      relationStyles.value = styles;
      boxPresets.value = presets;
      layerMasters.value = masters;
      if (!styles.some((row) => row.id === selectedRelationStyleId.value)) selectedRelationStyleId.value = styles[0]?.id ?? "";
      if (!presets.some((row) => row.id === selectedBoxPresetId.value)) {
        selectedBoxPresetId.value = presets.find((row) => row.is_default)?.id ?? presets[0]?.id ?? "";
      }
      return true;
    })();
    pendingLoad = { projectId, promise };
    try {
      return await promise;
    } finally {
      if (pendingLoad?.promise === promise) pendingLoad = null;
    }
  }

  async function loadLayerMasters() {
    layerMasters.value = await api.layerMasters();
  }

  return {
    keyLayoutTypes, keyDrawingTypes, keyShapes, relationStyles, boxPresets, layerMasters,
    selectedRelationStyleId, selectedBoxPresetId, syncFromGraph, loadAll,
    syncReferenceRow, removeReferenceRow, syncLayerMaster, removeLayerMasters, loadLayerMasters,
  };
});
