import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { AppView, EditorMode, Point, ReviewTargetDraft, SelectionItem } from "../types";

export const useAppStore = defineStore("app", () => {
  const storedVisibility = (key: string) => typeof localStorage === "undefined" || localStorage.getItem(key) !== "0";
  const view = ref<AppView>("home");
  const mode = ref<EditorMode>("select");
  const status = ref("준비");
  const busy = ref(false);
  const selection = ref<SelectionItem[]>([]);
  const labelField = ref<"name" | "step">("name");
  const focusRequest = ref<{ layerId: string; nonce: number } | null>(null);
  const layerMasterPickerOpen = ref(false);
  const lastCanvasActivity = ref<Point | null>(null);
  const showBoxPresetLegend = ref(storedVisibility("ric-editor-box-preset-legend"));
  const showArrowLegend = ref(storedVisibility("ric-editor-arrow-legend"));
  const reviewOpen = ref(false);
  const reviewTarget = ref<ReviewTargetDraft | null>(null);

  const selectedLayerIds = computed(() => selection.value.filter((item) => item.kind === "layer").map((item) => item.id));
  const selectedSplitLayerId = computed(() => selectedLayerIds.value.length === 1 ? selectedLayerIds.value[0] : null);

  async function run<T>(label: string, job: () => Promise<T>) {
    busy.value = true;
    status.value = `${label}...`;
    try {
      const result = await job();
      status.value = `${label} 완료`;
      return result;
    } catch (error) {
      status.value = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      busy.value = false;
    }
  }

  function select(item: SelectionItem, additive = false) {
    if (!additive) selection.value = [item];
    else if (selection.value.some((row) => row.kind === item.kind && row.id === item.id)) {
      selection.value = selection.value.filter((row) => row.kind !== item.kind || row.id !== item.id);
    } else selection.value = [...selection.value, item];
  }

  function clearSelection() { selection.value = [] }
  function markCanvasActivity(point: Point) { lastCanvasActivity.value = { ...point } }
  function clearCanvasActivity() { lastCanvasActivity.value = null }
  function openReview(target: ReviewTargetDraft | null = null) { reviewTarget.value = target; reviewOpen.value = true }
  function closeReview() { reviewOpen.value = false; reviewTarget.value = null }
  function setLegendVisibility(legend: "box" | "arrow", visible: boolean) {
    if (legend === "box") showBoxPresetLegend.value = visible;
    else showArrowLegend.value = visible;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(
        legend === "box" ? "ric-editor-box-preset-legend" : "ric-editor-arrow-legend",
        visible ? "1" : "0",
      );
    }
  }

  return {
    view, mode, status, busy, selection, labelField, focusRequest, layerMasterPickerOpen, lastCanvasActivity,
    showBoxPresetLegend, showArrowLegend, reviewOpen, reviewTarget, selectedLayerIds, selectedSplitLayerId, run, select, clearSelection,
    markCanvasActivity, clearCanvasActivity, openReview, closeReview, setLegendVisibility,
  };
});
