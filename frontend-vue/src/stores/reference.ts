import { ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../api/client";
import type { BoxPreset, Graph, KeyDrawingType, KeyLayoutType, KeyShape, LayerMaster, RelationStyle } from "../types";

export const useReferenceStore = defineStore("reference", () => {
  const keyLayoutTypes = ref<KeyLayoutType[]>([]);
  const keyDrawingTypes = ref<KeyDrawingType[]>([]);
  const keyShapes = ref<KeyShape[]>([]);
  const relationStyles = ref<RelationStyle[]>([]);
  const boxPresets = ref<BoxPreset[]>([]);
  const layerMasters = ref<LayerMaster[]>([]);
  const selectedRelationStyleId = ref("");
  const selectedBoxPresetId = ref("");

  function syncFromGraph(graph: Graph) {
    relationStyles.value = graph.relation_styles;
    boxPresets.value = graph.box_presets;
    selectedRelationStyleId.value ||= graph.relation_styles[0]?.id ?? "";
    selectedBoxPresetId.value ||= graph.box_presets.find((row) => row.is_default)?.id ?? graph.box_presets[0]?.id ?? "";
  }

  async function loadAll() {
    const [layouts, drawings, shapes, styles, presets, masters] = await Promise.all([
      api.keyLayoutTypes(), api.keyDrawingTypes(), api.keyShapes(), api.relationStyles(), api.boxPresets(), api.layerMasters(),
    ]);
    keyLayoutTypes.value = layouts;
    keyDrawingTypes.value = drawings;
    keyShapes.value = shapes;
    relationStyles.value = styles;
    boxPresets.value = presets;
    layerMasters.value = masters;
  }

  return {
    keyLayoutTypes, keyDrawingTypes, keyShapes, relationStyles, boxPresets, layerMasters,
    selectedRelationStyleId, selectedBoxPresetId, syncFromGraph, loadAll,
  };
});
