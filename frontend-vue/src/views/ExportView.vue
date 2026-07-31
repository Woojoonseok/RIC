<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as XLSX from "xlsx";
import { api } from "../api/client";
import { exportExcel, exportPptx, exportSvg } from "../domain/export";
import { buildFinalTable, finalTableMatrix } from "../domain/finalTable";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";
import type { AlignTree, RelationUpdate } from "../types";

type FinalField =
  | "key_priority"
  | "final_type"
  | "key_purpose"
  | "placement"
  | "stack_type"
  | "inregi"
  | "inner_size"
  | "outer_size";

const graph = useGraphStore();
const project = useProjectStore();
const reference = useReferenceStore();
const referenceReady = ref(false);
const finalTable = computed(() => (
  graph.rawGraph
    ? buildFinalTable(
        graph.rawGraph,
        reference.layerMasters,
        reference.keyLayoutTypes,
        reference.keyDrawingTypes,
      )
    : null
));

function value(event: Event) {
  return (event.target as HTMLInputElement).value;
}

type LayerTextField = "layer_process_names" | "layer_gds_names";

async function saveLayerText(field: LayerTextField, layerId: string, nextValue: string) {
  if (!graph.rawGraph?.align_tree) return;
  const values = { ...(graph.rawGraph.align_tree[field] ?? {}), [layerId]: nextValue };
  await graph.mutateGraph(
    field === "layer_process_names" ? "Layer 공정명 저장" : "Layer GDS 저장",
    () => api.updateAlignTree(
      project.currentProjectId,
      graph.rawGraph!.align_tree!.id,
      { [field]: values },
    ),
    false,
  );
}

function finalCellValue(tree: AlignTree, relationId: string, layerId: string, fallback: string) {
  const row = tree.final_table_cells?.[relationId];
  return row && Object.prototype.hasOwnProperty.call(row, layerId) ? row[layerId] : fallback;
}

async function saveFinalCell(relationId: string, layerId: string, nextValue: string) {
  if (!graph.rawGraph?.align_tree) return;
  const current = graph.rawGraph.align_tree.final_table_cells ?? {};
  const cells = {
    ...current,
    [relationId]: { ...(current[relationId] ?? {}), [layerId]: nextValue },
  };
  await graph.mutateGraph(
    "Overlay Key Table 셀 저장",
    () => api.updateAlignTree(
      project.currentProjectId,
      graph.rawGraph!.align_tree!.id,
      { final_table_cells: cells },
    ),
    false,
  );
}

async function saveRelationField(relationId: string, field: FinalField, nextValue: string) {
  const body: RelationUpdate = { [field]: nextValue || null };
  await graph.mutateGraph(
    "Overlay Key Table 저장",
    () => api.updateRelation(project.projectId, relationId, body),
  );
}

function exportFinalExcel() {
  if (!graph.rawGraph?.align_tree || !finalTable.value) return;
  const matrix = finalTableMatrix(
    finalTable.value,
    graph.rawGraph.align_tree.layer_process_names,
    graph.rawGraph.align_tree.layer_gds_names,
    graph.rawGraph.align_tree.final_table_cells,
  );
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  sheet["!cols"] = [
    { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 16 },
    { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
    { wch: 14 }, ...finalTable.value.layers.map(() => ({ wch: 10 })),
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "Overlay_Key_Table");
  XLSX.writeFile(workbook, `${graph.rawGraph.project.name}_Overlay_Key_Table.xlsx`);
}

onMounted(async () => {
  await reference.loadAll();
  referenceReady.value = true;
});
</script>

<template>
  <section class="page wide-page final-table-page">
    <div class="page-title final-table-title">
      <div>
        <p class="eyebrow">OVERLAY KEY EDITOR</p>
        <h1>Overlay Key Table</h1>
        <p>Overlay Key Editor의 Relation과 Layer 정보를 표로 정리합니다.</p>
      </div>
      <div v-if="graph.displayGraph" class="button-strip final-export-actions">
        <button class="primary" @click="exportFinalExcel">Overlay Key Excel</button>
        <button @click="exportExcel(graph.displayGraph!)">Raw Excel</button>
        <button @click="exportSvg(graph.displayGraph!)">SVG</button>
        <button @click="exportPptx(graph.displayGraph!)">PPTX</button>
      </div>
    </div>

    <div v-if="graph.rawGraph?.align_tree && finalTable && referenceReady" class="final-table-shell">
      <div class="final-table-scroll">
        <table class="final-table">
          <thead>
            <tr class="final-table-meta">
              <td colspan="12" class="final-table-meta-spacer"/>
              <th>LAYER</th>
              <td v-if="!finalTable.layers.length" class="missing-value">Layer 번호 없음</td>
              <td v-for="layer in finalTable.layers" :key="`process-${layer.layerId}`" class="final-table-meta-value">
                <input
                  :value="graph.rawGraph.align_tree.layer_process_names?.[layer.layerId] ?? ''"
                  :disabled="!project.canEdit"
                  maxlength="160"
                  @change="saveLayerText('layer_process_names', layer.layerId, value($event))"
                >
              </td>
            </tr>
            <tr class="final-table-meta">
              <td colspan="12" class="final-table-meta-spacer"/>
              <th>STEP</th>
              <th v-if="!finalTable.layers.length" class="missing-value">Layer 번호 없음</th>
              <th v-for="layer in finalTable.layers" :key="`step-${layer.layerId}`">
                {{ layer.number || "미지정" }}
              </th>
            </tr>
            <tr class="final-table-meta">
              <td colspan="12" class="final-table-meta-spacer"/>
              <th>GDS</th>
              <td v-if="!finalTable.layers.length" class="missing-value">Layer 번호 없음</td>
              <td v-for="layer in finalTable.layers" :key="`gds-${layer.layerId}`" class="final-table-meta-value">
                <input
                  :value="graph.rawGraph.align_tree.layer_gds_names?.[layer.layerId] ?? ''"
                  :disabled="!project.canEdit"
                  maxlength="160"
                  @change="saveLayerText('layer_gds_names', layer.layerId, value($event))"
                >
              </td>
            </tr>
            <tr class="final-table-main">
              <th>Key 이름</th>
              <th>기능별 Key</th>
              <th>Key Type</th>
              <th>No.</th>
              <th>Inner(아들자)</th>
              <th>Outer(어미자)</th>
              <th>Type</th>
              <th>key목적</th>
              <th>Placement</th>
              <th>Stack종류</th>
              <th>INREGI여부</th>
              <th>Inner Size</th>
              <th>Outer Size</th>
              <th v-for="layer in finalTable.layers" :key="`header-${layer.layerId}`">
                {{ layer.number || "미지정" }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in finalTable.rows" :key="row.relation.id">
              <th class="generated-key">{{ row.keyName || "Layer 번호 필요" }}</th>
              <td>{{ row.keyLayoutType || "-" }}</td>
              <td>{{ row.keyDrawingType || "-" }}</td>
              <td><input :value="row.relation.key_priority || ''" :disabled="!project.canEdit" @change="saveRelationField(row.relation.id, 'key_priority', value($event))"></td>
              <td class="number-cell">{{ row.inner || "-" }}</td>
              <td class="number-cell">{{ row.outer || "-" }}</td>
              <td><input :value="row.relation.final_type || ''" :disabled="!project.canEdit" @change="saveRelationField(row.relation.id, 'final_type', value($event))"></td>
              <td><input :value="row.relation.key_purpose || ''" :disabled="!project.canEdit" @change="saveRelationField(row.relation.id, 'key_purpose', value($event))"></td>
              <td><input :value="row.relation.placement || ''" :disabled="!project.canEdit" @change="saveRelationField(row.relation.id, 'placement', value($event))"></td>
              <td><input :value="row.relation.stack_type || ''" :disabled="!project.canEdit" @change="saveRelationField(row.relation.id, 'stack_type', value($event))"></td>
              <td><input :value="row.relation.inregi || ''" :disabled="!project.canEdit" @change="saveRelationField(row.relation.id, 'inregi', value($event))"></td>
              <td><input :value="row.relation.inner_size || ''" :disabled="!project.canEdit" @change="saveRelationField(row.relation.id, 'inner_size', value($event))"></td>
              <td><input :value="row.relation.outer_size || ''" :disabled="!project.canEdit" @change="saveRelationField(row.relation.id, 'outer_size', value($event))"></td>
              <td
                v-for="layer in finalTable.layers"
                :key="`${row.relation.id}-${layer.layerId}`"
                class="marker-cell"
                :class="{
                  open: finalCellValue(graph.rawGraph.align_tree, row.relation.id, layer.layerId, layer.marker) === 'O',
                  close: finalCellValue(graph.rawGraph.align_tree, row.relation.id, layer.layerId, layer.marker) === 'X',
                }"
              >
                <input
                  :value="finalCellValue(graph.rawGraph.align_tree, row.relation.id, layer.layerId, layer.marker)"
                  :disabled="!project.canEdit"
                  maxlength="160"
                  @change="saveFinalCell(row.relation.id, layer.layerId, value($event))"
                >
              </td>
            </tr>
            <tr v-if="!finalTable.rows.length">
              <td :colspan="13 + Math.max(1, finalTable.layers.length)" class="final-table-empty">
                Overlay Key Editor에서 Relation을 생성하면 Key 행이 표시됩니다.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-else class="empty-page">Overlay Key 데이터를 불러오는 중입니다.</div>
  </section>
</template>
