<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowDown, ArrowRight, Expand, LayoutGrid, Pin, PinOff, X } from "@lucide/vue";
import { api } from "../../api/client";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";
import { useProjectStore } from "../../stores/project";
import type { AutoLayoutRequest } from "../../types";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const scope = ref<AutoLayoutRequest["scope"]>("all");
const preset = ref<AutoLayoutRequest["preset"]>("top_down");
const routeRelations = ref(true);
const busy = ref(false);
const selectedLayoutIds = computed(() => {
  const anchors = new Set(app.selectedLayerIds);
  return graph.rawGraph?.layers
    .filter((layer) => anchors.has(graph.anchorByLayerId[layer.id] ?? layer.id))
    .map((layer) => layer.id) ?? [];
});
const selectedLayouts = computed(() => graph.rawGraph?.layouts.filter((layout) => selectedLayoutIds.value.includes(layout.layer_id)) ?? []);
const selectedPinned = computed(() => selectedLayouts.value.length > 0 && selectedLayouts.value.every((layout) => layout.pinned));

watch(() => props.open, (open) => {
  if (open && selectedLayoutIds.value.length) scope.value = "selected";
});

async function applyLayout() {
  if (scope.value === "selected" && !selectedLayoutIds.value.length) return;
  busy.value = true;
  try {
    await graph.mutateGraph("고급 자동 배치", () => api.autoLayout(project.projectId, {
      scope: scope.value,
      layer_ids: scope.value === "selected" ? selectedLayoutIds.value : [],
      preset: preset.value,
      route_relations: routeRelations.value,
    }));
    emit("close");
  } finally {
    busy.value = false;
  }
}

async function setPinned(pinned: boolean) {
  if (!selectedLayoutIds.value.length) return;
  await graph.mutateGraph(pinned ? "Layer 고정" : "Layer 고정 해제", () => api.batchGraph(project.projectId, {
    layouts: selectedLayoutIds.value.map((layer_id) => ({ layer_id, pinned })),
  }));
}
</script>

<template>
  <div v-if="open" class="layout-modal-backdrop" @pointerdown.self="emit('close')">
    <section class="layout-modal" role="dialog" aria-modal="true" aria-labelledby="layout-modal-title">
      <header>
        <div><h2 id="layout-modal-title">고급 자동 배치</h2><p>고정된 Layer와 선택 범위 밖 Layer는 현재 위치를 유지합니다.</p></div>
        <button class="layout-icon-button" title="닫기" aria-label="자동 배치 닫기" @click="emit('close')"><X :size="18"/></button>
      </header>
      <div class="layout-modal-body">
        <fieldset>
          <legend>배치 범위</legend>
          <div class="layout-segmented">
            <button :class="{ active: scope === 'all' }" @click="scope = 'all'">전체 Layer</button>
            <button :class="{ active: scope === 'selected' }" :disabled="!selectedLayoutIds.length" @click="scope = 'selected'">선택 Layer {{ selectedLayoutIds.length }}</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Layout Preset</legend>
          <div class="layout-presets">
            <button :class="{ active: preset === 'top_down' }" @click="preset = 'top_down'"><ArrowDown :size="18"/><span><b>위에서 아래</b><small>기본 계층 배치</small></span></button>
            <button :class="{ active: preset === 'left_right' }" @click="preset = 'left_right'"><ArrowRight :size="18"/><span><b>왼쪽에서 오른쪽</b><small>가로 흐름 배치</small></span></button>
            <button :class="{ active: preset === 'compact' }" @click="preset = 'compact'"><LayoutGrid :size="18"/><span><b>Compact</b><small>좁은 간격</small></span></button>
            <button :class="{ active: preset === 'spacious' }" @click="preset = 'spacious'"><Expand :size="18"/><span><b>Spacious</b><small>넓은 간격</small></span></button>
          </div>
        </fieldset>
        <label class="layout-toggle"><input v-model="routeRelations" type="checkbox"><span><b>관계선 자동 정리</b><small>노드를 피하는 직각 경로로 다시 배치</small></span></label>
        <div class="layout-pin-row">
          <span><b>선택 Layer 고정</b><small>자동 배치에서 위치 유지</small></span>
          <button :disabled="!selectedLayoutIds.length" @click="setPinned(!selectedPinned)"><PinOff v-if="selectedPinned" :size="16"/><Pin v-else :size="16"/>{{ selectedPinned ? '고정 해제' : '고정' }}</button>
        </div>
      </div>
      <footer><button @click="emit('close')">취소</button><button class="primary" :disabled="busy || (scope === 'selected' && !selectedLayoutIds.length)" @click="applyLayout">{{ busy ? '배치 중...' : '적용' }}</button></footer>
    </section>
  </div>
</template>
