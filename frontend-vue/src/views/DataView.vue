<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ChevronDown, ClipboardPaste, Download, Plus, Trash2 } from "@lucide/vue";
import SpreadsheetGrid from "../components/grid/SpreadsheetGrid.vue";
import { api } from "../api/client";
import { exportExcel } from "../domain/export";
import { formatLayerNumber } from "../domain/finalTable";
import { parseTsv } from "../domain/tsv";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";
import type { PortName, Relation, RelationCreate, RelationEndpointType, RelationUpdate } from "../types";

type Row = Record<string, unknown>;
interface GridColumn {
  key: string;
  label: string;
  width?: number;
  readonly?: boolean;
  options?: Array<{ value: string; label: string }>;
  action?: boolean;
}
interface RelationEditor {
  id: string;
  parentId: string;
  childId: string;
  keyLayoutTypeId: string;
  keyDrawingTypeId: string;
  relationStyleId: string;
  parentDrawingTypeId: string;
  childDrawingTypeId: string;
  comment: string;
  keyPriority: string;
  priorityRule: string;
  sourcePort: PortName;
  targetPort: PortName;
}
interface ExtraDraft {
  id: string;
  layerMasterId: string;
  drawingTypeId: string;
}

const SPARE_ENDPOINT = "__spare__";

const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const reference = useReferenceStore();
const pasteOpen = ref(false);
const pasteText = ref("");
const relationEditor = ref<RelationEditor | null>(null);
const extraEditor = ref<{ relationId: string; rows: ExtraDraft[] } | null>(null);

function drawingLabel(id: string | null | undefined) {
  const row = reference.keyDrawingTypes.find((item) => item.id === id);
  return row?.symbol || row?.key_shape || row?.drawing_guide || id || "";
}
function layerNumberLabel(layerId: string | null | undefined) {
  const layer = graph.rawGraph?.layers.find((item) => item.id === layerId);
  const master = layer?.layer_master_id
    ? reference.layerMasters.find((item) => item.id === layer.layer_master_id)
    : undefined;
  return formatLayerNumber(master?.layer_number || layer?.step) || "Layer 번호 미지정";
}
function endpointLabel(relation: Relation, side: "parent" | "child") {
  return relation[`${side}_endpoint_type`] === "spare"
    ? "SPARE"
    : layerNumberLabel(relation[`${side}_layer_id`]);
}
function options(rows: Array<{ id: string }>, label: (row: { id: string }) => string) {
  return [{ value: "", label: "선택 안 함" }, ...rows.map((row) => ({ value: row.id, label: label(row) }))];
}

const relationColumns = computed<GridColumn[]>(() => [
  {
    key: "key_layout_type_id",
    label: "Key 배치",
    width: 170,
    options: options(reference.keyLayoutTypes, (row) => reference.keyLayoutTypes.find((item) => item.id === row.id)?.name || row.id),
  },
  {
    key: "key_drawing_type_id",
    label: "Key Type",
    width: 160,
    options: options(reference.keyDrawingTypes, (row) => drawingLabel(row.id)),
  },
  { key: "parent", label: "Parent Layer 번호", width: 180, action: true },
  { key: "child", label: "Child Layer 번호", width: 180, action: true },
  { key: "comment", label: "Comment", width: 220 },
  {
    key: "relation_style_id",
    label: "Relation Type",
    width: 170,
    options: options(reference.relationStyles, (row) => reference.relationStyles.find((item) => item.id === row.id)?.name || row.id),
  },
  {
    key: "parent_drawing_type_id",
    label: "Parent Drawing",
    width: 180,
    options: options(reference.keyDrawingTypes, (row) => drawingLabel(row.id)),
  },
  {
    key: "child_drawing_type_id",
    label: "Child Drawing",
    width: 180,
    options: options(reference.keyDrawingTypes, (row) => drawingLabel(row.id)),
  },
  { key: "key_priority", label: "Key 우선순위", width: 140 },
  { key: "priority_rule", label: "우선순위 Rule", width: 200 },
  { key: "extras_summary", label: "Extra", width: 120, action: true, readonly: true },
]);

const selectedRelationIds = computed(() => app.selection
  .filter((item) => item.kind === "relation")
  .map((item) => item.id));
const relationRows = computed<Row[]>(() => {
  return graph.rawGraph?.relations.filter((row) => !row.same_group).map((row) => ({
    ...row,
    parent: endpointLabel(row, "parent"),
    child: endpointLabel(row, "child"),
    extras_summary: `${row.extras.length}개`,
  })) ?? [];
});

function selectRelation(id: string, additive: boolean) {
  app.select({ kind: "relation", id }, additive);
}
function setRelationSelection(ids: string[]) {
  app.selection = ids.map((id) => ({ kind: "relation" as const, id }));
}
function editRelation(row: Row = {}) {
  if (!project.canEdit) return;
  relationEditor.value = {
    id: String(row.id || ""),
    parentId: row.parent_endpoint_type === "spare" ? SPARE_ENDPOINT : String(row.parent_layer_id || ""),
    childId: row.child_endpoint_type === "spare" ? SPARE_ENDPOINT : String(row.child_layer_id || ""),
    keyLayoutTypeId: String(row.key_layout_type_id || ""),
    keyDrawingTypeId: String(row.key_drawing_type_id || ""),
    relationStyleId: String(row.relation_style_id || reference.selectedRelationStyleId || ""),
    parentDrawingTypeId: String(row.parent_drawing_type_id || ""),
    childDrawingTypeId: String(row.child_drawing_type_id || ""),
    comment: String(row.comment || ""),
    keyPriority: String(row.key_priority || ""),
    priorityRule: String(row.priority_rule || ""),
    sourcePort: String(row.source_port || "bottom") as PortName,
    targetPort: String(row.target_port || "top") as PortName,
  };
}
function openExtras(row: Row) {
  const relation = graph.rawGraph?.relations.find((item) => item.id === String(row.id || ""));
  if (!relation) return;
  extraEditor.value = {
    relationId: relation.id,
    rows: relation.extras.map((extra) => ({
      id: extra.id,
      layerMasterId: extra.layer_master_id,
      drawingTypeId: extra.key_drawing_type_id,
    })),
  };
}
function handleCellAction(row: Row, key: string) {
  if (key === "extras_summary") openExtras(row);
  else editRelation(row);
}
function addExtra() {
  extraEditor.value?.rows.push({
    id: `draft-${crypto.randomUUID()}`,
    layerMasterId: "",
    drawingTypeId: "",
  });
}
async function saveExtras() {
  if (!extraEditor.value || !project.canEdit) return;
  const rows = extraEditor.value.rows.filter((row) => row.layerMasterId && row.drawingTypeId);
  await graph.mutateGraph(
    "Extra Layer 저장",
    () => api.updateRelation(project.projectId, extraEditor.value!.relationId, {
      extras: rows.map((row, index) => ({
        layer_master_id: row.layerMasterId,
        key_drawing_type_id: row.drawingTypeId,
        sort_order: index,
      })),
    }),
  );
  extraEditor.value = null;
}
function relationBody(editor: RelationEditor): RelationCreate & RelationUpdate {
  const relationStyle = reference.relationStyles.find((row) => row.id === editor.relationStyleId);
  const parentIsSpare = editor.parentId === SPARE_ENDPOINT;
  const childIsSpare = editor.childId === SPARE_ENDPOINT;
  return {
    parent_endpoint_type: parentIsSpare ? "spare" : "layer",
    child_endpoint_type: childIsSpare ? "spare" : "layer",
    parent_layer_id: parentIsSpare ? null : editor.parentId,
    child_layer_id: childIsSpare ? null : editor.childId,
    key_layout_type_id: editor.keyLayoutTypeId || null,
    key_drawing_type_id: editor.keyDrawingTypeId || null,
    relation_type: relationStyle?.name || "parent_child",
    relation_style_id: editor.relationStyleId || null,
    parent_drawing_type_id: editor.parentDrawingTypeId || null,
    child_drawing_type_id: editor.childDrawingTypeId || null,
    comment: editor.comment || null,
    key_priority: editor.keyPriority || null,
    priority_rule: editor.priorityRule || null,
    source_port: editor.sourcePort,
    target_port: editor.targetPort,
  };
}
async function saveRelation() {
  const editor = relationEditor.value;
  if (!editor?.parentId || !editor.childId) return;
  if (editor.parentId === editor.childId && editor.parentId !== SPARE_ENDPOINT) return;
  const body = relationBody(editor);
  if (editor.id) {
    await graph.mutateGraph("Relation 수정", () => api.updateRelation(project.projectId, editor.id, body));
  } else {
    await graph.createRelationExpanded(body);
  }
  relationEditor.value = null;
}

function endpointFromValue(value: unknown, layerIds: Map<string, string>) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "spare") {
    return { type: "spare" as RelationEndpointType, layerId: null, valid: true };
  }
  const layerId = layerIds.get(normalized) ?? null;
  return { type: "layer" as RelationEndpointType, layerId, valid: Boolean(layerId) };
}

function idFromValue(
  value: unknown,
  rows: Array<{ id: string }>,
  label: (row: { id: string }) => string,
) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  return rows.find((row) => row.id === value || label(row).trim().toLowerCase() === normalized)?.id ?? null;
}
async function commitRelations(rows: Row[]) {
  if (!project.canEdit) return;
  project.markSaving();
  const layerIds = new Map(
    graph.rawGraph?.layers.map((row) => [layerNumberLabel(row.id).trim().toLowerCase(), row.id]),
  );
  try {
    for (const row of rows) {
      const parent = endpointFromValue(row.parent, layerIds);
      const child = endpointFromValue(row.child, layerIds);
      const relationStyleId = idFromValue(
        row.relation_style_id,
        reference.relationStyles,
        (item) => reference.relationStyles.find((candidate) => candidate.id === item.id)?.name || item.id,
      );
      const relationStyle = reference.relationStyles.find((item) => item.id === relationStyleId);
      const body: RelationCreate & RelationUpdate = {
        parent_endpoint_type: parent.type,
        child_endpoint_type: child.type,
        parent_layer_id: parent.layerId,
        child_layer_id: child.layerId,
        key_layout_type_id: idFromValue(
          row.key_layout_type_id,
          reference.keyLayoutTypes,
          (item) => reference.keyLayoutTypes.find((candidate) => candidate.id === item.id)?.name || item.id,
        ),
        key_drawing_type_id: idFromValue(
          row.key_drawing_type_id,
          reference.keyDrawingTypes,
          (item) => drawingLabel(item.id),
        ),
        relation_type: relationStyle?.name || String(row.relation_type || "parent_child"),
        relation_style_id: relationStyleId,
        parent_drawing_type_id: idFromValue(row.parent_drawing_type_id, reference.keyDrawingTypes, (item) => drawingLabel(item.id)),
        child_drawing_type_id: idFromValue(row.child_drawing_type_id, reference.keyDrawingTypes, (item) => drawingLabel(item.id)),
        comment: String(row.comment || "") || null,
        key_priority: String(row.key_priority || "") || null,
        priority_rule: String(row.priority_rule || "") || null,
        source_port: String(row.source_port || "bottom") as PortName,
        target_port: String(row.target_port || "top") as PortName,
      };
      if (row.id) await api.updateRelation(project.projectId, String(row.id), body);
      else if (parent.valid && child.valid) await graph.createRelationExpanded(body);
    }
    await graph.reloadGraph();
    project.markSaved();
    app.status = "Relation 자동 저장 완료";
  } catch (error) {
    project.handleMutationError(error);
    app.status = error instanceof Error ? error.message : String(error);
  }
}
async function deleteSelected() {
  if (!selectedRelationIds.value.length) return;
  project.markSaving();
  try {
    for (const id of selectedRelationIds.value) await api.deleteRelation(project.projectId, id);
    app.clearSelection();
    await graph.reloadGraph();
    project.markSaved();
  } catch (error) {
    project.handleMutationError(error);
    app.status = error instanceof Error ? error.message : String(error);
  }
}
function rowsFromMatrix(matrix: unknown[][]): Row[] {
  const keys = relationColumns.value.filter((column) => column.key !== "extras_summary").map((column) => column.key);
  return matrix
    .filter((row) => row.some((cell) => String(cell ?? "").trim()))
    .map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ""])));
}
async function applyPaste() {
  await commitRelations(rowsFromMatrix(parseTsv(pasteText.value)));
  pasteOpen.value = false;
  pasteText.value = "";
}
onMounted(async () => {
  await Promise.all([reference.loadAll(), graph.reloadGraph()]);
});
</script>

<template>
  <section class="page wide-page data-page">
    <div class="page-title">
      <div>
        <p class="eyebrow">STRUCTURED INPUT</p>
        <h1>Layer Relation</h1>
        <p>Parent와 Child 관계, Key 기준정보와 Drawing을 관리합니다.</p>
      </div>
    </div>
    <div v-if="graph.rawGraph" class="panel data-panel relation-data-panel">
      <div class="panel-heading data-actions">
        <div><h2>Layer Relation</h2><span>{{ relationRows.length }} rows</span></div>
        <div class="relation-data-toolbar">
          <button class="primary" :disabled="!project.canEdit" @click="editRelation()"><Plus :size="16"/>Relation 추가</button>
          <button class="danger ghost" :disabled="!project.canEdit || !selectedRelationIds.length" @click="deleteSelected"><Trash2 :size="15"/>선택 삭제</button>
          <span class="layer-action-divider"/>
          <details class="action-menu">
            <summary>데이터 도구<ChevronDown :size="14"/></summary>
            <div>
              <button type="button" @click="exportExcel(graph.rawGraph!)"><Download :size="15"/>Excel 내보내기</button>
              <button type="button" :disabled="!project.canEdit" @click="pasteOpen = true"><ClipboardPaste :size="15"/>표 붙여넣기</button>
            </div>
          </details>
        </div>
      </div>
      <SpreadsheetGrid
        auto-commit
        :readonly="project.readOnly"
        :columns="relationColumns"
        :rows="relationRows"
        :selected-rows="selectedRelationIds"
        empty-hint="Relation 추가에서 Parent와 Child Layer를 선택하세요."
        @row-select="selectRelation"
        @row-selection="setRelationSelection"
        @cell-action="handleCellAction"
        @commit="commitRelations"
      />
    </div>
    <div v-else class="empty-page">프로젝트를 선택하세요.</div>

    <div v-if="pasteOpen" class="paste-overlay" @click="pasteOpen = false">
      <section class="panel paste-panel" @click.stop>
        <div class="panel-heading"><h2>Layer Relation Paste</h2><button @click="pasteOpen = false">닫기</button></div>
        <textarea v-model="pasteText" autofocus placeholder="Excel에서 복사한 표를 붙여 넣으세요."/>
        <div class="sheet-actions"><button class="primary" @click="applyPaste">적용</button></div>
      </section>
    </div>

    <div v-if="relationEditor" class="paste-overlay" @click="relationEditor = null">
      <section class="panel relation-picker-panel relation-detail-panel" @click.stop>
        <div class="panel-heading">
          <div><p class="eyebrow">LAYER RELATION</p><h2>Relation 설정</h2></div>
          <button aria-label="닫기" @click="relationEditor = null">×</button>
        </div>
        <div class="relation-pair-picker">
          <label>
            <span>Parent Layer 번호</span>
            <select v-model="relationEditor.parentId">
              <option value="">Parent 선택</option>
              <option :value="SPARE_ENDPOINT">SPARE</option>
              <option v-for="layer in graph.rawGraph?.layers" :key="layer.id" :value="layer.id" :disabled="layer.id === relationEditor?.childId">{{ layerNumberLabel(layer.id) }}</option>
            </select>
          </label>
          <div class="relation-direction">→</div>
          <label>
            <span>Child Layer 번호</span>
            <select v-model="relationEditor.childId">
              <option value="">Child 선택</option>
              <option :value="SPARE_ENDPOINT">SPARE</option>
              <option v-for="layer in graph.rawGraph?.layers" :key="layer.id" :value="layer.id" :disabled="layer.id === relationEditor?.parentId">{{ layerNumberLabel(layer.id) }}</option>
            </select>
          </label>
        </div>
        <div class="relation-picker-options relation-core-options">
          <label>Key 배치<select v-model="relationEditor.keyLayoutTypeId"><option value="">선택 안 함</option><option v-for="row in reference.keyLayoutTypes" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
          <label>Key Type<select v-model="relationEditor.keyDrawingTypeId"><option value="">선택 안 함</option><option v-for="row in reference.keyDrawingTypes" :key="row.id" :value="row.id">{{ drawingLabel(row.id) }}</option></select></label>
          <label>Relation Type<select v-model="relationEditor.relationStyleId"><option value="">선택 안 함</option><option v-for="row in reference.relationStyles" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
          <label>Parent Drawing<select v-model="relationEditor.parentDrawingTypeId"><option value="">선택 안 함</option><option v-for="row in reference.keyDrawingTypes" :key="row.id" :value="row.id">{{ drawingLabel(row.id) }}</option></select></label>
          <label>Child Drawing<select v-model="relationEditor.childDrawingTypeId"><option value="">선택 안 함</option><option v-for="row in reference.keyDrawingTypes" :key="row.id" :value="row.id">{{ drawingLabel(row.id) }}</option></select></label>
          <label>Key 우선순위<input v-model="relationEditor.keyPriority"></label>
          <label class="relation-wide-field">우선순위 Rule<textarea v-model="relationEditor.priorityRule"/></label>
          <label class="relation-wide-field">Comment<textarea v-model="relationEditor.comment"/></label>
          <label>Source Port<select v-model="relationEditor.sourcePort"><option>top</option><option>right</option><option>bottom</option><option>left</option></select></label>
          <label>Target Port<select v-model="relationEditor.targetPort"><option>top</option><option>right</option><option>bottom</option><option>left</option></select></label>
        </div>
        <div class="sheet-actions">
          <button @click="relationEditor = null">취소</button>
          <button class="primary" :disabled="!relationEditor.parentId || !relationEditor.childId || (relationEditor.parentId === relationEditor.childId && relationEditor.parentId !== SPARE_ENDPOINT)" @click="saveRelation">{{ relationEditor.id ? "Relation 변경" : "Relation 연결" }}</button>
        </div>
      </section>
    </div>

    <div v-if="extraEditor" class="paste-overlay" @click="extraEditor = null">
      <section class="panel relation-extra-panel" @click.stop>
        <div class="panel-heading">
          <div><p class="eyebrow">RELATION EXTRA</p><h2>Extra Layer / Drawing</h2></div>
          <button aria-label="닫기" @click="extraEditor = null">×</button>
        </div>
        <div class="extra-list">
          <div v-for="(row, index) in extraEditor.rows" :key="row.id" class="extra-row">
            <span>{{ index + 1 }}</span>
            <label>Extra Layer<select v-model="row.layerMasterId" :disabled="!project.canEdit"><option value="">Layer 정보 선택</option><option v-for="layer in reference.layerMasters" :key="layer.id" :value="layer.id">{{ formatLayerNumber(layer.layer_number) || "Layer 번호 미지정" }}</option></select></label>
            <label>Extra Drawing<select v-model="row.drawingTypeId" :disabled="!project.canEdit"><option value="">Key Drawing Type 선택</option><option v-for="drawing in reference.keyDrawingTypes" :key="drawing.id" :value="drawing.id">{{ drawingLabel(drawing.id) }}</option></select></label>
            <button v-if="project.canEdit" class="danger" aria-label="Extra 삭제" @click="extraEditor.rows.splice(index, 1)">삭제</button>
          </div>
          <p v-if="!extraEditor.rows.length" class="empty">등록된 Extra 항목이 없습니다.</p>
        </div>
        <div class="sheet-actions">
          <button v-if="project.canEdit" @click="addExtra">Extra 추가</button>
          <button @click="extraEditor = null">닫기</button>
          <button v-if="project.canEdit" class="primary" @click="saveExtras">저장</button>
        </div>
      </section>
    </div>
  </section>
</template>
