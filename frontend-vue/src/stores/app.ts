import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { AppView, EditorMode, SelectionItem } from "../types";

export const useAppStore = defineStore("app", () => {
  const view = ref<AppView>("home");
  const mode = ref<EditorMode>("select");
  const status = ref("준비");
  const busy = ref(false);
  const selection = ref<SelectionItem[]>([]);
  const labelField = ref<"name" | "step">("name");
  const focusRequest = ref<{ layerId: string; nonce: number } | null>(null);
  const layerMasterPickerOpen = ref(false);

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

  return {
    view, mode, status, busy, selection, labelField, focusRequest, layerMasterPickerOpen,
    selectedLayerIds, selectedSplitLayerId, run, select, clearSelection,
  };
});
