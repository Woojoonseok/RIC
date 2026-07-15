<script setup lang="ts">
import { computed, ref } from "vue";
import * as XLSX from "xlsx";
import SpreadsheetGrid from "../components/grid/SpreadsheetGrid.vue";
import { api } from "../api/client";
import { parseTsv } from "../domain/tsv";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import type { LayerCreate, LayerUpdate, PortName, RelationCreate, RelationUpdate } from "../types";

type Row = Record<string, unknown>;
type Tab = "align" | "relation";
const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const tab = ref<Tab>("align");
const connectTargetId = ref("");
const pasteTarget = ref<Tab | null>(null);
const pasteText = ref("");
const upload = ref<HTMLInputElement | null>(null);

const layerColumns = [
  { key: "step", label: "Step", width: 120 }, { key: "name", label: "Layer", width: 180 },
  { key: "layer_property", label: "Layer Property", width: 160 }, { key: "align", label: "Align", width: 140 },
  { key: "align_side", label: "Align Side", width: 120 }, { key: "group", label: "Group", width: 130 },
  { key: "description", label: "Description", width: 220 },
];
const relationColumns = [
  { key: "parent", label: "Parent Layer", width: 180 }, { key: "child", label: "Child Layer", width: 180 },
  { key: "relation_type", label: "Relation Type", width: 150 }, { key: "instance", label: "Instance", width: 130 },
  { key: "source_port", label: "Source Port", width: 110 }, { key: "target_port", label: "Target Port", width: 110 },
];
const selectedLayerIds = computed(() => app.selection.filter((item) => item.kind === "layer").map((item) => item.id));
const selectedRelationIds = computed(() => app.selection.filter((item) => item.kind === "relation").map((item) => item.id));
const layerRows = computed<Row[]>(() => graph.rawGraph?.layers.map((row) => ({
  ...row,
  group: row.pending_group || Object.entries(graph.groupToLayerIds).find(([, ids]) => ids.includes(row.id))?.[0] || "",
})) ?? []);
const relationRows = computed<Row[]>(() => {
  const names = new Map(graph.rawGraph?.layers.map((row) => [row.id, row.name]));
  return graph.rawGraph?.relations.filter((row) => !row.same_group).map((row) => ({
    ...row,
    parent: row.parent_layer_id ? names.get(row.parent_layer_id) ?? "" : "",
    child: row.child_layer_id ? names.get(row.child_layer_id) ?? "" : "",
  })) ?? [];
});

function selectLayer(id: string, additive: boolean) { app.select({ kind: "layer", id }, additive) }
function selectRelation(id: string, additive: boolean) { app.select({ kind: "relation", id }, additive) }
async function addLayer() {
  const index = (graph.rawGraph?.layers.length ?? 0) + 1;
  await graph.mutateGraph("Layer 행 추가", () => api.createLayer(project.projectId, { name: `Layer ${index}`, x: 100 + index * 20, y: 100 + index * 20 }));
}
async function addRelation() {
  await graph.mutateGraph("관계 행 추가", () => api.createRelation(project.projectId, { parent_layer_id: null, child_layer_id: null, relation_type: "parent_child", source_port: "bottom", target_port: "top" }));
}
async function commitLayers(rows: Row[]) {
  for (const row of rows) {
    const body: LayerUpdate = {
      name: String(row.name ?? "").trim(), step: String(row.step || "") || null,
      layer_property: String(row.layer_property || "") || null, align: String(row.align || "") || null,
      align_side: String(row.align_side || "") || null, description: String(row.description || "") || null,
    };
    let id = row.id ? String(row.id) : "";
    if (id) await api.updateLayer(project.projectId, id, body);
    else if (body.name) id = (await api.createLayer(project.projectId, body as LayerCreate)).id;
    if (id) await api.updateGroup(project.projectId, id, String(row.group || "") || null);
  }
  await graph.reloadGraph();
  app.status = "Align Input 저장 완료";
}
async function commitRelations(rows: Row[]) {
  const ids = new Map(graph.rawGraph?.layers.map((row) => [row.name.trim().toLowerCase(), row.id]));
  for (const row of rows) {
    const body: RelationCreate & RelationUpdate = {
      parent_layer_id: ids.get(String(row.parent ?? "").trim().toLowerCase()) ?? null,
      child_layer_id: ids.get(String(row.child ?? "").trim().toLowerCase()) ?? null,
      relation_type: String(row.relation_type || "parent_child"), instance: String(row.instance || "") || null,
      source_port: String(row.source_port || "bottom") as PortName, target_port: String(row.target_port || "top") as PortName,
    };
    if (row.id) await api.updateRelation(project.projectId, String(row.id), body);
    else if (body.parent_layer_id && body.child_layer_id) await graph.createRelationExpanded(body);
    else await api.createRelation(project.projectId, body);
  }
  await graph.reloadGraph();
  app.status = "Layer Relation 저장 완료";
}
async function groupSelected() {
  if (selectedLayerIds.value.length < 2) return;
  const label = prompt("그룹 이름", "Group 1")?.trim();
  if (!label) return;
  for (const id of selectedLayerIds.value) await api.updateGroup(project.projectId, id, label);
  await graph.reloadGraph();
  app.status = `${selectedLayerIds.value.length}개 Layer 그룹화 완료`;
}
async function connectSelected() {
  if (!connectTargetId.value) return;
  let count = 0;
  for (const sourceId of selectedLayerIds.value) {
    if (sourceId === connectTargetId.value) continue;
    await graph.createRelationExpanded({ parent_layer_id: sourceId, child_layer_id: connectTargetId.value, relation_type: "parent_child" });
    count += 1;
  }
  connectTargetId.value = "";
  app.status = `${count}개 연결 요청 완료`;
}
async function deleteSelected() {
  if (tab.value === "align") {
    if (!selectedLayerIds.value.length || !confirm(`${selectedLayerIds.value.length}개 Layer를 삭제할까요?`)) return;
    for (const id of selectedLayerIds.value) await api.deleteLayer(project.projectId, id);
  } else {
    for (const id of selectedRelationIds.value) await api.deleteRelation(project.projectId, id);
  }
  app.clearSelection();
  await graph.reloadGraph();
}
function rowsFromMatrix(matrix: unknown[][], target: Tab): Row[] {
  const keys = (target === "align" ? layerColumns : relationColumns).map((column) => column.key);
  return matrix.filter((row) => row.some((cell) => String(cell ?? "").trim())).map((row) => Object.fromEntries(keys.map((key, index) => [key, row[index] ?? ""])));
}
async function applyPaste() {
  const rows = rowsFromMatrix(parseTsv(pasteText.value), pasteTarget.value ?? tab.value);
  if (pasteTarget.value === "relation") await commitRelations(rows); else await commitLayers(rows);
  pasteTarget.value = null; pasteText.value = "";
}
async function uploadFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const workbook = XLSX.read(await file.arrayBuffer());
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
  const rows = rowsFromMatrix(matrix.slice(1), tab.value);
  if (tab.value === "align") await commitLayers(rows); else await commitRelations(rows);
  (event.target as HTMLInputElement).value = "";
}
</script>

<template>
  <section class="page wide-page data-page">
    <div class="page-title"><div><p class="eyebrow">STRUCTURED INPUT</p><h1>Data</h1><p>Excel 방식으로 Layer와 관계를 입력하고 그룹·일괄 연결을 수행합니다.</p></div></div>
    <nav class="subtabs"><button :class="{ active: tab === 'align' }" @click="tab = 'align'">Align Input</button><button :class="{ active: tab === 'relation' }" @click="tab = 'relation'">Layer Relation</button></nav>
    <div v-if="graph.rawGraph" class="panel data-panel">
      <div class="panel-heading data-actions">
        <div><h2>{{ tab === 'align' ? 'Align Input' : 'Layer Relation' }}</h2><span>{{ tab === 'align' ? layerRows.length : relationRows.length }} rows</span></div>
        <div class="button-strip">
          <button @click="tab === 'align' ? addLayer() : addRelation()">Add Row</button>
          <button v-if="tab === 'align'" :disabled="selectedLayerIds.length < 2" @click="groupSelected">Group ({{ selectedLayerIds.length }})</button>
          <button :disabled="tab === 'align' ? !selectedLayerIds.length : !selectedRelationIds.length" class="danger" @click="deleteSelected">Delete</button>
          <button @click="upload?.click()">Excel Upload</button><button @click="pasteTarget = tab">Clipboard Paste</button>
        </div>
      </div>
      <div v-if="tab === 'align' && selectedLayerIds.length" class="bulk-connect"><span>Connect {{ selectedLayerIds.length }} selected →</span><select v-model="connectTargetId"><option value="">Target Layer</option><option v-for="layer in graph.rawGraph.layers" :key="layer.id" :value="layer.id">{{ layer.name }}</option></select><button :disabled="!connectTargetId" @click="connectSelected">Connect</button></div>
      <input ref="upload" hidden type="file" accept=".xlsx,.xls,.csv,.tsv" @change="uploadFile">
      <SpreadsheetGrid v-if="tab === 'align'" :columns="layerColumns" :rows="layerRows" :selected-rows="selectedLayerIds" empty-hint="Layer 행을 추가하거나 붙여넣으세요." @row-select="selectLayer" @commit="commitLayers"/>
      <SpreadsheetGrid v-else :columns="relationColumns" :rows="relationRows" :selected-rows="selectedRelationIds" empty-hint="관계 행을 추가하거나 붙여넣으세요." @row-select="selectRelation" @commit="commitRelations"/>
    </div>
    <div v-else class="empty-page">프로젝트를 선택하세요.</div>
    <div v-if="pasteTarget" class="paste-overlay" @click="pasteTarget = null">
      <section class="panel paste-panel" @click.stop><div class="panel-heading"><h2>{{ pasteTarget === 'align' ? 'Align Input' : 'Layer Relation' }} Paste</h2><button @click="pasteTarget = null">닫기</button></div><textarea v-model="pasteText" autofocus placeholder="Excel에서 복사한 셀을 여기에 붙여넣으세요."/><div class="sheet-actions"><button class="primary" @click="applyPaste">적용</button></div></section>
    </div>
  </section>
</template>
