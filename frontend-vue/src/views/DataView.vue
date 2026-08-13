<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardPaste, Download, FilterX, Plus, Search, Trash2, X } from "@lucide/vue";
import SpreadsheetGrid from "../components/grid/SpreadsheetGrid.vue";
import { api } from "../api/client";
import { formatLayerNumber } from "../domain/finalTable";
import { expandRelationCandidates } from "../domain/graph";
import { parseTsv } from "../domain/tsv";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";
import type { PortName, Relation, RelationCreate, RelationEndpointType, RelationImportIssue, RelationImportPreview, RelationImportRequest, RelationUpdate } from "../types";

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
interface PastePreview extends RelationImportPreview {
  source_count: number;
  request: RelationImportRequest;
}

const SPARE_ENDPOINT = "__spare__";

const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const reference = useReferenceStore();
const pasteOpen = ref(false);
const pasteText = ref("");
const pasteBusy = ref(false);
const pastePreview = ref<PastePreview | null>(null);
const relationEditor = ref<RelationEditor | null>(null);
const extraEditor = ref<{ relationId: string; rows: ExtraDraft[] } | null>(null);
const columnFilters = ref<Record<string, string[]>>({});
const activeFilterKey = ref<string | null>(null);
const filterDraft = ref<string[]>([]);
const filterSearch = ref("");
const filterMenuPosition = ref({ top: 0, left: 0 });

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
const relationPasteColumns = computed(() => relationColumns.value.filter((column) => column.key !== "extras_summary"));

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
function relationRowsMatchingFilters(excludedKey?: string) {
  return relationRows.value.filter((row) => Object.entries(columnFilters.value).every(([key, selected]) => (
    key === excludedKey || selected.includes(String(row[key] ?? ""))
  )));
}
const displayedRelationRows = computed(() => relationRowsMatchingFilters());

function relationDownloadValue(row: Row, column: GridColumn) {
  const value = String(row[column.key] ?? "");
  return column.options?.find((option) => option.value === value)?.label || value;
}
function relationFileName(suffix: string) {
  const projectName = project.currentProject?.name || "RIC";
  return `${projectName}_${suffix}`.replace(/[\\/:*?"<>|]+/g, "_");
}
async function downloadRelationWorkbook(columns: GridColumn[], rows: Row[], fileName: string) {
  const XLSX = await import("xlsx-js-style");
  const matrix = [
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => relationDownloadValue(row, column))),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  sheet["!cols"] = columns.map((column) => ({ wch: Math.max(14, Math.round((column.width ?? 140) / 8)) }));
  sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}${Math.max(1, matrix.length)}` };
  columns.forEach((_column, index) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c: index })];
    if (cell) cell.s = {
      fill: { fgColor: { rgb: "344054" } },
      font: { bold: true, color: { rgb: "FFFFFF" } },
      alignment: { horizontal: "center", vertical: "center" },
    };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Layer Relation");
  XLSX.writeFile(workbook, fileName);
}
async function downloadRelationTemplate() {
  await downloadRelationWorkbook(relationPasteColumns.value, [], "RIC_Layer_Relation_Template.xlsx");
  app.status = "Layer Relation 템플릿을 다운로드했습니다.";
}
async function downloadCurrentRelationTable() {
  await downloadRelationWorkbook(
    relationColumns.value,
    displayedRelationRows.value,
    `${relationFileName("Layer_Relation")}.xlsx`,
  );
  app.status = `현재 Relation Table ${displayedRelationRows.value.length}개 행을 다운로드했습니다.`;
}
const activeFilterValues = computed(() => {
  if (!activeFilterKey.value) return [];
  return [...new Set(relationRowsMatchingFilters(activeFilterKey.value).map((row) => String(row[activeFilterKey.value!] ?? "")))]
    .sort((left, right) => filterDisplayLabel(activeFilterKey.value!, left).localeCompare(
      filterDisplayLabel(activeFilterKey.value!, right),
      "ko",
      { numeric: true, sensitivity: "base" },
    ));
});
const searchedFilterValues = computed(() => {
  const needle = filterSearch.value.trim().toLocaleLowerCase("ko");
  return needle
    ? activeFilterValues.value.filter((value) => filterDisplayLabel(activeFilterKey.value!, value).toLocaleLowerCase("ko").includes(needle))
    : activeFilterValues.value;
});
const activeFilterLabel = computed(() => relationColumns.value.find((column) => column.key === activeFilterKey.value)?.label ?? "컬럼");

function filterDisplayLabel(key: string, value: string) {
  const column = relationColumns.value.find((item) => item.key === key);
  return column?.options?.find((option) => option.value === value)?.label || value || "(빈 셀)";
}
function openColumnFilter(key: string, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  activeFilterKey.value = key;
  filterSearch.value = "";
  filterDraft.value = columnFilters.value[key] ? [...columnFilters.value[key]] : [...activeFilterValues.value];
  filterMenuPosition.value = {
    top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 360)),
    left: Math.max(12, Math.min(rect.right - 280, window.innerWidth - 292)),
  };
}
function closeColumnFilter() { activeFilterKey.value = null }
function toggleFilterValue(value: string) {
  filterDraft.value = filterDraft.value.includes(value)
    ? filterDraft.value.filter((item) => item !== value)
    : [...filterDraft.value, value];
}
function applyColumnFilter() {
  if (!activeFilterKey.value) return;
  const key = activeFilterKey.value;
  const allSelected = filterDraft.value.length === activeFilterValues.value.length
    && activeFilterValues.value.every((value) => filterDraft.value.includes(value));
  const { [key]: _removed, ...rest } = columnFilters.value;
  columnFilters.value = allSelected ? rest : { ...rest, [key]: [...filterDraft.value] };
  closeColumnFilter();
}
function clearColumnFilter() {
  if (!activeFilterKey.value) return;
  const { [activeFilterKey.value]: _removed, ...rest } = columnFilters.value;
  columnFilters.value = rest;
  closeColumnFilter();
}

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

function importReferenceId(
  value: unknown,
  rows: Array<{ id: string }>,
  label: (row: { id: string }) => string,
  fieldLabel: string,
  rowNumber: number,
  issues: RelationImportIssue[],
) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const id = idFromValue(raw, rows, label);
  if (!id) issues.push({ row_number: rowNumber, code: "mapping_error", message: `${fieldLabel} '${raw}'을(를) 찾을 수 없습니다.` });
  return id;
}

function relationImportRequest(sourceRows: Row[]) {
  const issues: RelationImportIssue[] = [];
  const request: RelationImportRequest = { rows: [] };
  const layerIds = new Map(
    graph.rawGraph?.layers.map((row) => [layerNumberLabel(row.id).trim().toLowerCase(), row.id]),
  );
  sourceRows.forEach((row, index) => {
    const rowNumber = index + 1;
    const parent = endpointFromValue(row.parent, layerIds);
    const child = endpointFromValue(row.child, layerIds);
    if (!parent.valid) issues.push({ row_number: rowNumber, code: "mapping_error", message: `Parent Layer '${String(row.parent ?? "")}'을(를) 찾을 수 없습니다.` });
    if (!child.valid) issues.push({ row_number: rowNumber, code: "mapping_error", message: `Child Layer '${String(row.child ?? "")}'을(를) 찾을 수 없습니다.` });
    const relationStyleId = importReferenceId(
      row.relation_style_id,
      reference.relationStyles,
      (item) => reference.relationStyles.find((candidate) => candidate.id === item.id)?.name || item.id,
      "Relation Type",
      rowNumber,
      issues,
    );
    const relationStyle = reference.relationStyles.find((item) => item.id === relationStyleId);
    const body: RelationCreate = {
      parent_endpoint_type: parent.type,
      child_endpoint_type: child.type,
      parent_layer_id: parent.layerId,
      child_layer_id: child.layerId,
      key_layout_type_id: importReferenceId(
        row.key_layout_type_id,
        reference.keyLayoutTypes,
        (item) => reference.keyLayoutTypes.find((candidate) => candidate.id === item.id)?.name || item.id,
        "Key 배치",
        rowNumber,
        issues,
      ),
      key_drawing_type_id: importReferenceId(row.key_drawing_type_id, reference.keyDrawingTypes, (item) => drawingLabel(item.id), "Key Type", rowNumber, issues),
      relation_type: relationStyle?.name || "parent_child",
      relation_style_id: relationStyleId,
      parent_drawing_type_id: importReferenceId(row.parent_drawing_type_id, reference.keyDrawingTypes, (item) => drawingLabel(item.id), "Parent Drawing", rowNumber, issues),
      child_drawing_type_id: importReferenceId(row.child_drawing_type_id, reference.keyDrawingTypes, (item) => drawingLabel(item.id), "Child Drawing", rowNumber, issues),
      comment: String(row.comment || "") || null,
      key_priority: String(row.key_priority || "") || null,
      priority_rule: String(row.priority_rule || "") || null,
      source_port: "bottom",
      target_port: "top",
    };
    if (!parent.valid || !child.valid) return;
    try {
      const candidates = graph.rawGraph ? expandRelationCandidates(graph.rawGraph, body) : [];
      for (const relation of candidates) request.rows.push({ row_number: rowNumber, relation });
    } catch (error) {
      issues.push({ row_number: rowNumber, code: "relation_rule", message: error instanceof Error ? error.message : String(error) });
    }
  });
  return { request, issues };
}

async function previewPaste() {
  const sourceRows = rowsFromMatrix(parseTsv(pasteText.value));
  if (!sourceRows.length) {
    app.status = "붙여넣을 Relation 데이터가 없습니다.";
    return;
  }
  const built = relationImportRequest(sourceRows);
  pasteBusy.value = true;
  try {
    const serverPreview: RelationImportPreview = built.request.rows.length
      ? await api.previewRelationImport(project.projectId, built.request)
      : { total_count: 0, create_count: 0, error_count: 0, issues: [] };
    pastePreview.value = {
      ...serverPreview,
      source_count: sourceRows.length,
      error_count: built.issues.length + serverPreview.error_count,
      issues: [...built.issues, ...serverPreview.issues],
      request: built.request,
    };
  } catch (error) {
    project.handleMutationError(error);
    app.status = error instanceof Error ? error.message : String(error);
  } finally {
    pasteBusy.value = false;
  }
}

async function commitPaste() {
  if (!pastePreview.value || pastePreview.value.error_count || !pastePreview.value.request.rows.length) return;
  pasteBusy.value = true;
  project.markSaving();
  try {
    const result = await api.commitRelationImport(project.projectId, pastePreview.value.request);
    graph.setGraph(result.graph);
    project.markSaved();
    app.status = `Relation ${result.created_count}개 Import 완료`;
    pasteOpen.value = false;
    pasteText.value = "";
  } catch (error) {
    project.handleMutationError(error);
    app.status = error instanceof Error ? error.message : String(error);
  } finally {
    pasteBusy.value = false;
  }
}
watch(pasteText, () => { pastePreview.value = null });
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
        <div><h2>Layer Relation</h2><span>{{ displayedRelationRows.length }}<template v-if="Object.keys(columnFilters).length">/{{ relationRows.length }}</template>개 행</span></div>
        <div class="relation-data-toolbar">
          <button v-if="Object.keys(columnFilters).length" type="button" title="모든 필터 해제" @click="columnFilters = {}"><FilterX :size="15"/>필터 해제</button>
          <button class="primary" :disabled="!project.canEdit" @click="editRelation()"><Plus :size="16"/>Relation 추가</button>
          <button class="danger ghost" :disabled="!project.canEdit || !selectedRelationIds.length" @click="deleteSelected"><Trash2 :size="15"/>선택 삭제</button>
          <span class="layer-action-divider"/>
          <details class="action-menu">
            <summary>데이터 도구<ChevronDown :size="14"/></summary>
            <div>
              <button type="button" @click="downloadRelationTemplate"><Download :size="15"/>템플릿 다운로드</button>
              <button type="button" class="relation-table-download" @click="downloadCurrentRelationTable"><Download :size="15"/><span>Relation Table<br>다운로드</span></button>
              <button type="button" :disabled="!project.canEdit" @click="pasteOpen = true"><ClipboardPaste :size="15"/>표 붙여넣기</button>
            </div>
          </details>
        </div>
      </div>
      <SpreadsheetGrid
        auto-commit
        :readonly="project.readOnly"
        :columns="relationColumns"
        :rows="displayedRelationRows"
        :selected-rows="selectedRelationIds"
        filterable
        :filtered-columns="Object.keys(columnFilters)"
        empty-hint="Relation 추가에서 Parent와 Child Layer를 선택하세요."
        @row-select="selectRelation"
        @row-selection="setRelationSelection"
        @column-filter="openColumnFilter"
        @cell-action="handleCellAction"
        @commit="commitRelations"
      />
    </div>
    <div v-else class="empty-page">프로젝트를 선택하세요.</div>

    <div v-if="pasteOpen" class="paste-overlay" @click="pasteOpen = false">
      <section class="panel paste-panel relation-import-panel" @click.stop>
        <div class="panel-heading">
          <div><p class="eyebrow">ATOMIC IMPORT</p><h2>Layer Relation Paste</h2></div>
          <button @click="pasteOpen = false">닫기</button>
        </div>
        <textarea v-model="pasteText" autofocus placeholder="Excel에서 복사한 Relation 행을 붙여 넣으세요."/>
        <div v-if="pastePreview" class="relation-import-preview" :class="{ invalid: pastePreview.error_count }">
          <div class="relation-import-summary">
            <div><span>입력 행</span><b>{{ pastePreview.source_count }}</b></div>
            <div><span>생성 Relation</span><b>{{ pastePreview.create_count }}</b></div>
            <div><span>오류</span><b>{{ pastePreview.error_count }}</b></div>
          </div>
          <div v-if="pastePreview.issues.length" class="relation-import-issues">
            <div v-for="(issue, index) in pastePreview.issues" :key="`${issue.row_number}-${issue.code}-${index}`">
              <AlertTriangle :size="16"/>
              <span><strong>{{ issue.row_number ? `${issue.row_number}행` : '전체' }} · {{ issue.code }}</strong><small>{{ issue.message }}</small></span>
            </div>
          </div>
          <div v-else class="relation-import-ready"><CheckCircle2 :size="18"/><span>검증이 완료되었습니다. 저장하면 모든 Relation이 한 번에 반영됩니다.</span></div>
        </div>
        <div class="sheet-actions">
          <button :disabled="pasteBusy" @click="pasteOpen = false">취소</button>
          <button :disabled="pasteBusy || !pasteText.trim()" @click="previewPaste">{{ pasteBusy && !pastePreview ? '검증 중…' : '미리보기' }}</button>
          <button class="primary" :disabled="pasteBusy || !pastePreview || pastePreview.error_count > 0 || !pastePreview.create_count" @click="commitPaste">
            {{ pasteBusy && pastePreview ? '저장 중…' : `${pastePreview?.create_count ?? 0}개 저장` }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="activeFilterKey" class="final-table-filter-backdrop" @click="closeColumnFilter"/>
    <section
      v-if="activeFilterKey"
      class="final-table-filter-menu"
      :style="{ top: `${filterMenuPosition.top}px`, left: `${filterMenuPosition.left}px` }"
      @click.stop
    >
      <div class="final-table-filter-heading">
        <strong>{{ activeFilterLabel }} 필터</strong>
        <button type="button" title="닫기" aria-label="필터 닫기" @click="closeColumnFilter"><X :size="16"/></button>
      </div>
      <label class="final-table-filter-search">
        <Search :size="15"/>
        <input v-model="filterSearch" placeholder="값 검색">
      </label>
      <div class="final-table-filter-tools">
        <button type="button" @click="filterDraft = [...activeFilterValues]">모두 선택</button>
        <button type="button" @click="filterDraft = []">선택 해제</button>
      </div>
      <div class="final-table-filter-values">
        <label v-for="option in searchedFilterValues" :key="option">
          <input type="checkbox" :checked="filterDraft.includes(option)" @change="toggleFilterValue(option)">
          <span>{{ filterDisplayLabel(activeFilterKey, option) }}</span>
        </label>
        <p v-if="!searchedFilterValues.length">검색 결과가 없습니다.</p>
      </div>
      <div class="final-table-filter-actions">
        <button type="button" @click="clearColumnFilter">필터 해제</button>
        <button type="button" class="primary" @click="applyColumnFilter">적용</button>
      </div>
    </section>

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
