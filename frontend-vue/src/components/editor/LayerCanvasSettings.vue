<script setup lang="ts">
import { computed } from "vue";
import { api } from "../../api/client";
import { useGraphStore } from "../../stores/graph";
import { useProjectStore } from "../../stores/project";
import { useReferenceStore } from "../../stores/reference";
import type { Layer, LayoutUpdate, StyleUpdate } from "../../types";
import ColorPickerField from "./ColorPickerField.vue";
import { COLOR_SWATCHES } from "./propertyOptions";

const props = defineProps<{ layer: Layer }>();
const graph = useGraphStore();
const project = useProjectStore();
const reference = useReferenceStore();
const layout = computed(() => graph.rawGraph?.layouts.find((row) => row.layer_id === props.layer.id) ?? null);
const style = computed(() => graph.rawGraph?.styles.find((row) => row.layer_id === props.layer.id) ?? null);

function value(event: Event) {
  return (event.target as HTMLSelectElement).value;
}

function numberValue(event: Event) {
  return Number((event.target as HTMLInputElement).value);
}

async function updateLayout(body: LayoutUpdate) {
  await graph.mutateGraph("배치 저장", () => api.updateLayout(project.projectId, props.layer.id, body));
}

async function updateStyle(body: StyleUpdate) {
  await graph.mutateGraph("스타일 저장", () => api.updateStyle(project.projectId, props.layer.id, body));
}

async function applyBoxPreset(event: Event) {
  const preset = reference.boxPresets.find((row) => row.id === value(event));
  if (!preset) return;
  reference.selectedBoxPresetId = preset.id;
  await graph.mutateGraph("Box Type 적용", () => api.batchGraph(project.projectId, {
    layer_presets: [{ layer_id: props.layer.id, box_preset_id: preset.id }],
  }));
}
</script>

<template>
  <details v-if="layout || style" class="property-section canvas-settings-details">
    <summary><span><strong>Canvas 표시 설정</strong><small>위치·크기와 Box 스타일</small></span><span>›</span></summary>
    <div class="canvas-settings-grid">
      <section v-if="layout">
        <h3>위치 및 크기</h3>
        <label class="property-check"><input type="checkbox" :checked="layout.pinned" @change="updateLayout({ pinned: ($event.target as HTMLInputElement).checked })">자동 배치에서 위치 고정</label>
        <div class="property-grid">
          <label>X<input type="number" :value="layout.x" @change="updateLayout({ x: numberValue($event) })"></label>
          <label>Y<input type="number" :value="layout.y" @change="updateLayout({ y: numberValue($event) })"></label>
          <label>Width<input type="number" min="60" :value="layout.width" @change="updateLayout({ width: numberValue($event) })"></label>
          <label>Height<input type="number" min="36" :value="layout.height" @change="updateLayout({ height: numberValue($event) })"></label>
        </div>
      </section>
      <section v-if="style">
        <h3>스타일</h3>
        <label>Box Type<select :value="layer.box_preset_id || ''" @change="applyBoxPreset"><option value="" disabled>선택</option><option v-for="preset in reference.boxPresets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></label>
        <ColorPickerField label="Fill" :model-value="style.fill_color" @update:model-value="updateStyle({ fill_color: $event })"/>
        <div class="color-swatches"><button v-for="color in COLOR_SWATCHES" :key="color" type="button" class="color-swatch" :class="{ active: style.fill_color.toLowerCase() === color }" :style="{ background: color }" :aria-label="`Fill ${color}`" :title="color" @click="updateStyle({ fill_color: color })"/></div>
        <ColorPickerField label="Stroke" :model-value="style.stroke_color" @update:model-value="updateStyle({ stroke_color: $event })"/>
        <ColorPickerField label="Text" :model-value="style.text_color" @update:model-value="updateStyle({ text_color: $event })"/>
        <div class="property-grid">
          <label>Font size<input type="number" min="8" max="72" :value="style.font_size" @change="updateStyle({ font_size: numberValue($event) })"></label>
          <label>Stroke width<input type="number" min="1" max="12" :value="style.stroke_width" @change="updateStyle({ stroke_width: numberValue($event) })"></label>
        </div>
      </section>
    </div>
  </details>
</template>
