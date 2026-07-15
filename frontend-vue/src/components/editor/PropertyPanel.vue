<script setup lang="ts">
import { computed } from "vue";
import { api } from "../../api/client";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";
import { useProjectStore } from "../../stores/project";
import type { LayerUpdate, LayoutUpdate, PortName, RelationUpdate, StyleUpdate, TextBoxUpdate } from "../../types";

const app = useAppStore(); const graph = useGraphStore(); const project = useProjectStore();
const COLOR_SWATCHES = ["#ffffff", "#fef3c7", "#dbeafe", "#dcfce7", "#ffe4e6", "#e5e7eb", "#111827", "#2563eb", "#dc2626"];
const selectedLayers = computed(() => app.selection.filter((item) => item.kind === "layer").flatMap((item) => {
  const layer = graph.rawGraph?.layers.find((row) => row.id === item.id); return layer ? [layer] : [];
}));
const item = computed(() => app.selection.length === 1 ? app.selection[0] : null);
const layer = computed(() => selectedLayers.value.length === 1 ? selectedLayers.value[0] : null);
const layout = computed(() => layer.value ? graph.rawGraph?.layouts.find((row) => row.layer_id === layer.value!.id) : null);
const style = computed(() => layer.value ? graph.rawGraph?.styles.find((row) => row.layer_id === layer.value!.id) : null);
const relation = computed(() => item.value?.kind === "relation" ? graph.rawGraph?.relations.find((row) => row.id === item.value!.id) : null);
const text = computed(() => item.value?.kind === "text" ? graph.rawGraph?.text_boxes.find((row) => row.id === item.value!.id) : null);
async function updateLayer(body: LayerUpdate) { if (layer.value) await graph.mutateGraph("Layer 저장", () => api.updateLayer(project.projectId, layer.value!.id, body)) }
async function updateLayout(body: LayoutUpdate) { if (layer.value) await graph.mutateGraph("배치 저장", () => api.updateLayout(project.projectId, layer.value!.id, body)) }
async function updateStyle(body: StyleUpdate) { if (layer.value) await graph.mutateGraph("스타일 저장", () => api.updateStyle(project.projectId, layer.value!.id, body)) }
async function updateRelation(body: RelationUpdate) { if (relation.value) await graph.mutateGraph("관계 저장", () => api.updateRelation(project.projectId, relation.value!.id, body)) }
async function updateText(body: TextBoxUpdate) { if (text.value) await graph.mutateGraph("텍스트 저장", () => api.updateText(project.projectId, text.value!.id, body)) }
async function updateSelectedStyles(body: StyleUpdate) {
  if (!selectedLayers.value.length) return;
  await graph.mutateGraph("다중 스타일 저장", () => api.batchGraph(project.projectId, { styles: selectedLayers.value.map((row) => ({ layer_id: row.id, ...body })) }));
}
async function updateSelectedLayouts(body: LayoutUpdate) {
  await graph.mutateGraph("다중 배치 저장", () => api.batchGraph(project.projectId, { layouts: selectedLayers.value.map((row) => ({ layer_id: row.id, ...body })) }));
}
async function updateSelectedLayers(body: LayerUpdate) {
  for (const row of selectedLayers.value) await api.updateLayer(project.projectId, row.id, body);
  await graph.reloadGraph();
}
function selectedPort(event: Event): PortName {
  const value = (event.target as HTMLSelectElement).value;
  return value === "top" || value === "right" || value === "bottom" || value === "left" ? value : "bottom";
}
function value(event: Event) { return (event.target as HTMLInputElement | HTMLTextAreaElement).value }
function numberValue(event: Event) { return Number((event.target as HTMLInputElement).value) }
</script>

<template>
  <aside class="property-panel">
    <div class="side-heading"><span>PROPERTIES</span><button v-if="app.selection.length" @click="app.clearSelection()">×</button></div>
    <div v-if="selectedLayers.length > 1" class="property-form multi-property">
      <div class="property-title"><div><strong>{{ selectedLayers.length }} Layers</strong><small>다중 편집</small></div></div>
      <label>Fill<input type="color" value="#dbeafe" @change="updateSelectedStyles({ fill_color: value($event) })"></label>
      <div class="color-swatches"><button v-for="color in COLOR_SWATCHES" :key="color" class="color-swatch" :style="{ background: color }" @click="updateSelectedStyles({ fill_color: color })"/></div>
      <label>Stroke<input type="color" value="#2563eb" @change="updateSelectedStyles({ stroke_color: value($event) })"></label>
      <label>Text<input type="color" value="#111827" @change="updateSelectedStyles({ text_color: value($event) })"></label>
      <label>Font size<input type="number" min="8" max="72" value="16" @change="updateSelectedStyles({ font_size: numberValue($event) })"></label>
      <label>Width<input type="number" min="60" value="180" @change="updateSelectedLayouts({ width: numberValue($event) })"></label>
      <label>Height<input type="number" min="36" value="72" @change="updateSelectedLayouts({ height: numberValue($event) })"></label>
      <label>Align<input @change="updateSelectedLayers({ align: value($event) || null })"></label>
      <div class="property-split"/>
      <button @click="graph.mutateGraph('Layer 병합', () => api.merge(project.projectId, { layer_ids: selectedLayers.map(row => row.id) }))">Merge Layers</button>
    </div>
    <div v-else-if="layer" class="property-form">
      <div class="property-title"><span class="layer-dot"/><div><strong>{{ layer.name }}</strong><small>Layer</small></div></div>
      <label>이름<input :value="layer.name" @change="updateLayer({ name: value($event) })"></label>
      <label>Step<input :value="layer.step" @change="updateLayer({ step: value($event) || null })"></label>
      <label>Property<input :value="layer.layer_property" @change="updateLayer({ layer_property: value($event) || null })"></label>
      <label>Align<input :value="layer.align" @change="updateLayer({ align: value($event) || null })"></label>
      <label>Align Side<input :value="layer.align_side" @change="updateLayer({ align_side: value($event) || null })"></label>
      <label>Description<textarea :value="layer.description" @change="updateLayer({ description: value($event) || null })"/></label>
      <label>Group<input :value="layer.pending_group" @change="graph.mutateGraph('그룹 저장', () => api.updateGroup(project.projectId, layer!.id, value($event) || null))"></label>
      <div class="property-split"/>
      <label v-if="layout">X<input type="number" :value="layout.x" @change="updateLayout({ x: numberValue($event) })"></label><label v-if="layout">Y<input type="number" :value="layout.y" @change="updateLayout({ y: numberValue($event) })"></label>
      <label v-if="layout">Width<input type="number" min="60" :value="layout.width" @change="updateLayout({ width: numberValue($event) })"></label><label v-if="layout">Height<input type="number" min="36" :value="layout.height" @change="updateLayout({ height: numberValue($event) })"></label>
      <div class="property-split"/>
      <label v-if="style">Fill<input type="color" :value="style.fill_color" @change="updateStyle({ fill_color: value($event) })"></label><div v-if="style" class="color-swatches"><button v-for="color in COLOR_SWATCHES" :key="color" class="color-swatch" :style="{ background: color }" @click="updateStyle({ fill_color: color })"/></div>
      <label v-if="style">Stroke<input type="color" :value="style.stroke_color" @change="updateStyle({ stroke_color: value($event) })"></label><label v-if="style">Text<input type="color" :value="style.text_color" @change="updateStyle({ text_color: value($event) })"></label>
      <label v-if="style">Font size<input type="number" min="8" max="72" :value="style.font_size" @change="updateStyle({ font_size: numberValue($event) })"></label><label v-if="style">Stroke width<input type="number" min="1" max="12" :value="style.stroke_width" @change="updateStyle({ stroke_width: numberValue($event) })"></label>
      <button @click="graph.mutateGraph('Layer 분할', () => api.split(project.projectId, layer!.id))">Split Layer</button>
    </div>
    <div v-else-if="relation" class="property-form">
      <div class="property-title"><span class="relation-dot"/><div><strong>Relation</strong><small>{{ relation.id.slice(0, 8) }}</small></div></div>
      <label>Type<select :value="relation.relation_type" @change="updateRelation({ relation_type: value($event) })"><option v-for="type in ['parent_child','reference','optional','blocking','overlay']" :key="type">{{ type }}</option></select></label>
      <label>Instance<input :value="relation.instance" @change="updateRelation({ instance: value($event) || null })"></label>
      <label>Source<select :value="relation.source_port" @change="updateRelation({ source_port: selectedPort($event) })"><option v-for="port in ['top','right','bottom','left']" :key="port">{{ port }}</option></select></label>
      <label>Target<select :value="relation.target_port" @change="updateRelation({ target_port: selectedPort($event) })"><option v-for="port in ['top','right','bottom','left']" :key="port">{{ port }}</option></select></label>
      <label>Arrow<select :value="relation.relation_style_id || ''" @change="updateRelation({ relation_style_id: value($event) || null })"><option value="">기본</option><option v-for="row in graph.rawGraph?.relation_styles" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
      <p class="meta-box">Waypoints {{ relation.waypoints?.length ?? 0 }}개<br>Attached {{ relation.attached_relation_id ? relation.attached_relation_id.slice(0, 8) : '없음' }}</p>
    </div>
    <div v-else-if="text" class="property-form">
      <div class="property-title"><strong>Text Box</strong></div><label>텍스트<textarea :value="text.text" @change="updateText({ text: value($event) })"/></label>
      <label>X<input type="number" :value="text.x" @change="updateText({ x: numberValue($event) })"></label><label>Y<input type="number" :value="text.y" @change="updateText({ y: numberValue($event) })"></label>
      <label>Width<input type="number" min="40" :value="text.width" @change="updateText({ width: numberValue($event) })"></label><label>Height<input type="number" min="24" :value="text.height" @change="updateText({ height: numberValue($event) })"></label>
      <label>Font Size<input type="number" min="8" max="96" :value="text.font_size" @change="updateText({ font_size: numberValue($event) })"></label><label>Text Color<input type="color" :value="text.text_color" @change="updateText({ text_color: value($event) })"></label>
      <label>Background<input type="color" :value="text.background_color" @change="updateText({ background_color: value($event) })"></label><label>Border<input type="color" :value="text.border_color" @change="updateText({ border_color: value($event) })"></label>
      <label>Locked<input type="checkbox" :checked="text.locked" @change="updateText({ locked: ($event.target as HTMLInputElement).checked })"></label>
    </div>
    <div v-else class="property-empty"><div class="empty-icon">◇</div><b>선택된 객체가 없습니다.</b><p>Canvas에서 Layer, 관계선 또는 Text Box를 선택하세요.</p></div>
  </aside>
</template>
