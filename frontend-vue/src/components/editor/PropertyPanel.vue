<script setup lang="ts">
import { computed, onMounted } from "vue";
import { api } from "../../api/client";
import { formatLayerNumber } from "../../domain/finalTable";
import { isMergedLayer, relationGroupById } from "../../domain/graph";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";
import { useProjectStore } from "../../stores/project";
import { useReferenceStore } from "../../stores/reference";
import type { LayerUpdate, LayoutUpdate, PortName, Relation, RelationUpdate, StyleUpdate, TextBoxUpdate } from "../../types";
import ColorPickerField from "./ColorPickerField.vue";

const app = useAppStore(); const graph = useGraphStore(); const project = useProjectStore(); const reference = useReferenceStore();
const emit = defineEmits<{ collapse: [] }>();
const COLOR_SWATCHES = ["#ffffff", "#fef3c7", "#dbeafe", "#dcfce7", "#ffe4e6", "#e5e7eb", "#111827", "#2563eb", "#dc2626"];
const selectedLayers = computed(() => app.selection.filter((item) => item.kind === "layer").flatMap((item) => {
  const layer = graph.rawGraph?.layers.find((row) => row.id === item.id); return layer ? [layer] : [];
}));
const item = computed(() => app.selection.length === 1 ? app.selection[0] : null);
const layer = computed(() => selectedLayers.value.length === 1 ? selectedLayers.value[0] : null);
const canSplitLayer = computed(() => Boolean(
  layer.value && graph.rawGraph && isMergedLayer(graph.rawGraph, layer.value.id),
));
const layout = computed(() => layer.value ? graph.rawGraph?.layouts.find((row) => row.layer_id === layer.value!.id) : null);
const style = computed(() => layer.value ? graph.rawGraph?.styles.find((row) => row.layer_id === layer.value!.id) : null);
const selectedRelation = computed(() => item.value?.kind === "relation"
  ? graph.rawGraph?.relations.find((row) => (
      row.id === item.value!.id
      && row.parent_endpoint_type !== "spare"
      && row.child_endpoint_type !== "spare"
    ))
  : null);
const relationGroup = computed(() => (
  graph.rawGraph && selectedRelation.value
    ? relationGroupById(graph.rawGraph, selectedRelation.value.id)
    : []
));
const text = computed(() => item.value?.kind === "text" ? graph.rawGraph?.text_boxes.find((row) => row.id === item.value!.id) : null);
const isDecorativeShape = computed(() => Boolean(text.value && (text.value.shape_type ?? "text") !== "text"));
async function updateLayer(body: LayerUpdate) { if (layer.value) await graph.mutateGraph("Layer 저장", () => api.updateLayer(project.projectId, layer.value!.id, body)) }
async function updateLayout(body: LayoutUpdate) { if (layer.value) await graph.mutateGraph("배치 저장", () => api.updateLayout(project.projectId, layer.value!.id, body)) }
async function updateStyle(body: StyleUpdate) { if (layer.value) await graph.mutateGraph("스타일 저장", () => api.updateStyle(project.projectId, layer.value!.id, body)) }
async function updateRelation(relationId: string, body: RelationUpdate) {
  await graph.mutateGraph("관계 저장", () => api.updateRelation(project.projectId, relationId, body));
}
async function resetRelationWaypoints() {
  const relations = relationGroup.value.filter((relation) => relation.waypoints?.length);
  if (!relations.length) return;
  await graph.mutateGraph("Relation 꺾임 초기화", async () => {
    await Promise.all(
      relations.map((relation) => api.updateRelation(project.projectId, relation.id, { waypoints: [] })),
    );
  });
}
async function deleteRelation(row: Relation) {
  if (!confirm("이 Relation을 삭제할까요?")) return;
  const next = relationGroup.value.find((relation) => relation.id !== row.id);
  await graph.mutateGraph("관계 삭제", () => api.deleteRelation(project.projectId, row.id));
  if (next) app.select({ kind: "relation", id: next.id });
  else app.clearSelection();
}
async function updateText(body: TextBoxUpdate) { if (text.value) await graph.mutateGraph("텍스트 저장", () => api.updateText(project.projectId, text.value!.id, body)) }
async function updateSelectedStyles(body: StyleUpdate) {
  if (!selectedLayers.value.length) return;
  await graph.mutateGraph("다중 스타일 저장", () => api.batchGraph(project.projectId, { styles: selectedLayers.value.map((row) => ({ layer_id: row.id, ...body })) }));
}
async function updateSelectedLayouts(body: LayoutUpdate) {
  await graph.mutateGraph("다중 배치 저장", () => api.batchGraph(project.projectId, { layouts: selectedLayers.value.map((row) => ({ layer_id: row.id, ...body })) }));
}
async function applyBoxPreset(event: Event) {
  const presetId = value(event);
  const preset = reference.boxPresets.find((row) => row.id === presetId);
  if (!preset || !selectedLayers.value.length) return;
  const layers = [...selectedLayers.value];
  reference.selectedBoxPresetId = preset.id;
  await graph.mutateGraph("Box Type 적용", () => api.batchGraph(project.projectId, {
    layer_presets: layers.map((row) => ({ layer_id: row.id, box_preset_id: preset.id })),
  }));
}
function selectedPort(event: Event): PortName {
  const value = (event.target as HTMLSelectElement).value;
  return value === "top" || value === "right" || value === "bottom" || value === "left" ? value : "bottom";
}
function value(event: Event) { return (event.target as HTMLInputElement | HTMLTextAreaElement).value }
function numberValue(event: Event) { return Number((event.target as HTMLInputElement).value) }
function drawingLabel(id: string) {
  const row = reference.keyDrawingTypes.find((item) => item.id === id);
  return row?.symbol || row?.key_shape || row?.drawing_guide || id;
}
function layerLabelById(id: string | null) {
  const layer = graph.rawGraph?.layers.find((row) => row.id === id);
  const master = layer?.layer_master_id
    ? reference.layerMasters.find((row) => row.id === layer.layer_master_id)
    : undefined;
  return formatLayerNumber(master?.layer_number || layer?.step) || "Layer 번호 미지정";
}
function relationStyleLabel(row: Relation) {
  return graph.rawGraph?.relation_styles.find((style) => style.id === row.relation_style_id)?.name ?? row.relation_type;
}
function extraLabel(layerMasterId: string, drawingTypeId: string) {
  const master = reference.layerMasters.find((row) => row.id === layerMasterId);
  const layerName = formatLayerNumber(master?.layer_number) || "Layer 번호 미지정";
  return `${layerName} / ${drawingLabel(drawingTypeId)}`;
}
onMounted(() => reference.loadAll());
</script>

<template>
  <aside class="property-panel">
    <div class="side-heading">
      <span>PROPERTIES</span>
      <div>
        <button v-if="app.selection.length" aria-label="선택 해제" title="선택 해제" @click="app.clearSelection()">×</button>
        <button class="panel-collapse-button" aria-label="Properties 패널 닫기" title="Properties 패널 닫기" @click="emit('collapse')">›</button>
      </div>
    </div>
    <fieldset class="property-fieldset" :disabled="!project.canEdit">
    <div v-if="selectedLayers.length > 1" class="property-form multi-property">
      <div class="property-title"><div><strong>{{ selectedLayers.length }} Layers</strong><small>다중 편집</small></div></div>
      <section class="property-section">
        <h3>위치 및 크기</h3>
        <div class="property-grid">
          <label>Width<input type="number" min="60" value="180" @change="updateSelectedLayouts({ width: numberValue($event) })"></label>
          <label>Height<input type="number" min="36" value="72" @change="updateSelectedLayouts({ height: numberValue($event) })"></label>
        </div>
      </section>
      <section class="property-section">
        <h3>스타일</h3>
        <label>Box Type<select :value="selectedLayers.every((row) => row.box_preset_id === selectedLayers[0]?.box_preset_id) ? selectedLayers[0]?.box_preset_id || '' : ''" @change="applyBoxPreset"><option value="" disabled>{{ selectedLayers.every((row) => row.box_preset_id === selectedLayers[0]?.box_preset_id) ? '선택' : '여러 Box Type' }}</option><option v-for="preset in reference.boxPresets" :key="preset.id" :value="preset.id">{{ preset.name }}</option></select></label>
        <ColorPickerField label="Fill" model-value="#dbeafe" @update:model-value="updateSelectedStyles({ fill_color: $event })"/>
        <div class="color-swatches"><button v-for="color in COLOR_SWATCHES" :key="color" type="button" class="color-swatch" :style="{ background: color }" :aria-label="`Fill ${color}`" :title="color" @click="updateSelectedStyles({ fill_color: color })"/></div>
        <ColorPickerField label="Stroke" model-value="#2563eb" @update:model-value="updateSelectedStyles({ stroke_color: $event })"/>
        <ColorPickerField label="Text" model-value="#111827" @update:model-value="updateSelectedStyles({ text_color: $event })"/>
        <div class="property-grid">
          <label>Font size<input type="number" min="8" max="72" value="16" @change="updateSelectedStyles({ font_size: numberValue($event) })"></label>
        </div>
      </section>
      <button @click="graph.mutateGraph('Layer 병합', () => api.merge(project.projectId, { layer_ids: selectedLayers.map(row => row.id) }))">Merge Layers</button>
    </div>
    <div v-else-if="layer" class="property-form">
      <div class="property-title"><span class="layer-dot"/><div><strong>{{ layer.name }}</strong><small>Layer</small></div></div>
      <section class="property-section">
        <h3>기본 정보</h3>
        <label>이름<input :value="layer.name" @change="updateLayer({ name: value($event) })"></label>
        <label>Step<input :value="layer.step" @change="updateLayer({ step: value($event) || null })"></label>
        <label>Group<input :value="layer.pending_group" @change="graph.mutateGraph('그룹 저장', () => api.updateGroup(project.projectId, layer!.id, value($event) || null))"></label>
      </section>
      <section v-if="layout" class="property-section">
        <h3>위치 및 크기</h3>
        <div class="property-grid">
          <label>X<input type="number" :value="layout.x" @change="updateLayout({ x: numberValue($event) })"></label>
          <label>Y<input type="number" :value="layout.y" @change="updateLayout({ y: numberValue($event) })"></label>
          <label>Width<input type="number" min="60" :value="layout.width" @change="updateLayout({ width: numberValue($event) })"></label>
          <label>Height<input type="number" min="36" :value="layout.height" @change="updateLayout({ height: numberValue($event) })"></label>
        </div>
      </section>
      <section v-if="style" class="property-section">
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
      <button v-if="canSplitLayer" @click="graph.mutateGraph('Layer 분할', () => api.split(project.projectId, layer!.id))">Split Layer</button>
    </div>
    <div v-else-if="selectedRelation" class="property-form relation-properties">
      <div class="property-title"><span class="relation-dot"/><div><strong>{{ layerLabelById(selectedRelation.parent_layer_id) }} → {{ layerLabelById(selectedRelation.child_layer_id) }}</strong><small>Relation {{ relationGroup.length }}개</small></div></div>
      <button
        type="button"
        class="relation-waypoint-reset"
        :disabled="!relationGroup.some((relation) => relation.waypoints?.length)"
        @click="resetRelationWaypoints"
      >
        꺾임 초기화
      </button>
      <details v-for="(relation, index) in relationGroup" :key="relation.id" class="relation-property-item" :open="relationGroup.length === 1">
        <summary><span>{{ index + 1 }}. {{ relationStyleLabel(relation) }}</span><small>{{ relation.id.slice(0, 8) }}</small></summary>
        <div class="relation-property-fields">
          <label>Key 배치<select :value="relation.key_layout_type_id || ''" @change="updateRelation(relation.id, { key_layout_type_id: value($event) || null })"><option value="">선택 안 함</option><option v-for="row in reference.keyLayoutTypes" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
          <label>Key Type<select :value="relation.key_drawing_type_id || ''" @change="updateRelation(relation.id, { key_drawing_type_id: value($event) || null })"><option value="">선택 안 함</option><option v-for="row in reference.keyDrawingTypes" :key="row.id" :value="row.id">{{ drawingLabel(row.id) }}</option></select></label>
          <label>Relation Type<select :value="relation.relation_style_id || ''" @change="updateRelation(relation.id, { relation_style_id: value($event) || null })"><option value="">선택 안 함</option><option v-for="row in graph.rawGraph?.relation_styles" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
          <label>Parent Drawing<select :value="relation.parent_drawing_type_id || ''" @change="updateRelation(relation.id, { parent_drawing_type_id: value($event) || null })"><option value="">선택 안 함</option><option v-for="row in reference.keyDrawingTypes" :key="row.id" :value="row.id">{{ drawingLabel(row.id) }}</option></select></label>
          <label>Child Drawing<select :value="relation.child_drawing_type_id || ''" @change="updateRelation(relation.id, { child_drawing_type_id: value($event) || null })"><option value="">선택 안 함</option><option v-for="row in reference.keyDrawingTypes" :key="row.id" :value="row.id">{{ drawingLabel(row.id) }}</option></select></label>
          <label>Key 우선순위<input :value="relation.key_priority || ''" @change="updateRelation(relation.id, { key_priority: value($event) || null })"></label>
          <label>우선순위 Rule<textarea :value="relation.priority_rule || ''" @change="updateRelation(relation.id, { priority_rule: value($event) || null })"/></label>
          <label>Comment<textarea :value="relation.comment || ''" @change="updateRelation(relation.id, { comment: value($event) || null })"/></label>
          <label>Source Port<select :value="relation.source_port" @change="updateRelation(relation.id, { source_port: selectedPort($event) })"><option v-for="port in ['top','right','bottom','left']" :key="port">{{ port }}</option></select></label>
          <label>Target Port<select :value="relation.target_port" @change="updateRelation(relation.id, { target_port: selectedPort($event) })"><option v-for="port in ['top','right','bottom','left']" :key="port">{{ port }}</option></select></label>
          <div class="relation-extra-summary">
            <strong>Extra {{ relation.extras.length }}개</strong>
            <span v-for="extra in relation.extras" :key="extra.id">{{ extraLabel(extra.layer_master_id, extra.key_drawing_type_id) }}</span>
          </div>
          <p class="meta-box">Waypoints {{ relation.waypoints?.length ?? 0 }}개<br>Attached {{ relation.attached_relation_id ? relation.attached_relation_id.slice(0, 8) : '없음' }}</p>
          <button type="button" class="danger-button relation-delete-button" @click="deleteRelation(relation)">Relation 삭제</button>
        </div>
      </details>
    </div>
    <div v-else-if="text" class="property-form">
      <div class="property-title"><strong>{{ isDecorativeShape ? '배경 도형' : 'Text Box' }}</strong></div>
      <label v-if="isDecorativeShape">도형<select :value="text.shape_type" @change="updateText({ shape_type: value($event) === 'ellipse' ? 'ellipse' : 'rectangle' })"><option value="rectangle">사각형</option><option value="ellipse">원</option></select></label>
      <label v-else>텍스트<textarea :value="text.text" @change="updateText({ text: value($event) })"/></label>
      <label>X<input type="number" :value="text.x" @change="updateText({ x: numberValue($event) })"></label><label>Y<input type="number" :value="text.y" @change="updateText({ y: numberValue($event) })"></label>
      <label>Width<input type="number" min="40" :value="text.width" @change="updateText({ width: numberValue($event) })"></label><label>Height<input type="number" min="24" :value="text.height" @change="updateText({ height: numberValue($event) })"></label>
      <label v-if="!isDecorativeShape">Font Size<input type="number" min="8" max="96" :value="text.font_size" @change="updateText({ font_size: numberValue($event) })"></label>
      <ColorPickerField v-if="!isDecorativeShape" label="Text Color" :model-value="text.text_color" @update:model-value="updateText({ text_color: $event })"/>
      <ColorPickerField :label="isDecorativeShape ? 'Fill' : 'Background'" :model-value="text.background_color" @update:model-value="updateText({ background_color: $event })"/>
      <ColorPickerField label="Border" :model-value="text.border_color" @update:model-value="updateText({ border_color: $event })"/>
      <label>Locked<input type="checkbox" :checked="text.locked" @change="updateText({ locked: ($event.target as HTMLInputElement).checked })"></label>
    </div>
    <div v-else class="property-empty"><div class="empty-icon">◇</div><b>선택된 객체가 없습니다.</b><p>Canvas에서 Layer, 관계선 또는 Text Box를 선택하세요.</p></div>
    </fieldset>
  </aside>
</template>
