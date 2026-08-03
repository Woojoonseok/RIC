<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ArrowDownAZ, ArrowUpAZ, Download, Filter, Search, X as CloseIcon } from "@lucide/vue";
import * as XLSX from "xlsx-js-style";
import { api } from "../api/client";
import { buildFinalTable } from "../domain/finalTable";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";
import type { FinalTableRow } from "../domain/finalTable";
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
const activeFilterKey = ref<string | null>(null);
const filterSearch = ref("");
const filterDraft = ref<string[]>([]);
const columnFilters = ref<Record<string, string[]>>({});
const sortState = ref<{ key: string; direction: "asc" | "desc" } | null>(null);
const filterMenuPosition = ref({ top: 0, left: 0 });
const fixedColumns = [
  { key: "keyName", label: "Key 이름" },
  { key: "keyLayoutType", label: "기능별 Key" },
  { key: "keyDrawingType", label: "Key Type" },
  { key: "key_priority", label: "No." },
  { key: "inner", label: "Inner(아들자)" },
  { key: "outer", label: "Outer(어미자)" },
  { key: "final_type", label: "Type" },
  { key: "key_purpose", label: "key목적" },
  { key: "placement", label: "Placement" },
  { key: "stack_type", label: "Stack종류" },
  { key: "inregi", label: "INREGI여부" },
  { key: "inner_size", label: "Inner Size" },
  { key: "outer_size", label: "Outer Size" },
] as const;
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

function columnValue(row: FinalTableRow, key: string): string {
  if (key === "keyName") return row.keyName;
  if (key === "keyLayoutType") return row.keyLayoutType;
  if (key === "keyDrawingType") return row.keyDrawingType;
  if (key === "inner") return row.inner;
  if (key === "outer") return row.outer;
  if (key.startsWith("layer:")) {
    const layerId = key.slice(6);
    const layer = finalTable.value?.layers.find((item) => item.layerId === layerId);
    return graph.rawGraph?.align_tree
      ? finalCellValue(graph.rawGraph.align_tree, row.relation.id, layerId, layer?.marker ?? "")
      : "";
  }
  return String((row.relation as unknown as Record<string, unknown>)[key] ?? "");
}

function rowsMatchingFilters(excludedKey?: string): FinalTableRow[] {
  const rows = finalTable.value?.rows ?? [];
  return rows.filter((row) => Object.entries(columnFilters.value).every(([key, selected]) => (
    key === excludedKey || selected.includes(columnValue(row, key))
  )));
}

function compareValues(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (left.trim() && right.trim() && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right, "ko", { numeric: true, sensitivity: "base" });
}

const displayedRows = computed(() => {
  const rows = rowsMatchingFilters();
  if (!sortState.value) return rows;
  const { key, direction } = sortState.value;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const compared = compareValues(columnValue(left.row, key), columnValue(right.row, key));
      return (direction === "asc" ? compared : -compared) || left.index - right.index;
    })
    .map(({ row }) => row);
});

const activeFilterValues = computed(() => {
  if (!activeFilterKey.value) return [];
  return [...new Set(rowsMatchingFilters(activeFilterKey.value).map((row) => columnValue(row, activeFilterKey.value!)))]
    .sort(compareValues);
});
const searchedFilterValues = computed(() => {
  const needle = filterSearch.value.trim().toLocaleLowerCase("ko");
  return needle
    ? activeFilterValues.value.filter((value) => value.toLocaleLowerCase("ko").includes(needle))
    : activeFilterValues.value;
});

function openFilter(key: string, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  activeFilterKey.value = key;
  filterSearch.value = "";
  const values = [...new Set(rowsMatchingFilters(key).map((row) => columnValue(row, key)))];
  filterDraft.value = columnFilters.value[key] ? [...columnFilters.value[key]] : values;
  filterMenuPosition.value = {
    top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 430)),
    left: Math.max(12, Math.min(rect.right - 280, window.innerWidth - 292)),
  };
}
function closeFilter() { activeFilterKey.value = null }
function toggleFilterValue(value: string) {
  filterDraft.value = filterDraft.value.includes(value)
    ? filterDraft.value.filter((item) => item !== value)
    : [...filterDraft.value, value];
}
function selectAllFilterValues() { filterDraft.value = [...activeFilterValues.value] }
function clearFilterValues() { filterDraft.value = [] }
function applyFilter() {
  if (!activeFilterKey.value) return;
  const key = activeFilterKey.value;
  const allValuesSelected = (
    filterDraft.value.length === activeFilterValues.value.length
    && activeFilterValues.value.every((value) => filterDraft.value.includes(value))
  );
  if (allValuesSelected) {
    const { [key]: _removed, ...rest } = columnFilters.value;
    columnFilters.value = rest;
  } else {
    columnFilters.value = { ...columnFilters.value, [key]: [...filterDraft.value] };
  }
  closeFilter();
}
function clearCurrentFilter() {
  if (!activeFilterKey.value) return;
  const { [activeFilterKey.value]: _removed, ...rest } = columnFilters.value;
  columnFilters.value = rest;
  closeFilter();
}
function sortBy(direction: "asc" | "desc") {
  if (!activeFilterKey.value) return;
  sortState.value = { key: activeFilterKey.value, direction };
  closeFilter();
}
function filterLabel(value: string) { return value || "(빈 셀)" }
function isColumnActive(key: string) {
  return Object.prototype.hasOwnProperty.call(columnFilters.value, key) || sortState.value?.key === key;
}

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
  const table = document.querySelector<HTMLTableElement>(".final-table");
  if (!table) return;
  const merges: XLSX.Range[] = [];
  const matrix = Array.from(table.rows).map((row, rowIndex) => {
    const values: string[] = [];
    let columnIndex = 0;
    for (const cell of Array.from(row.cells)) {
      const input = cell.querySelector<HTMLInputElement>("input");
      const cellValue = input ? input.value : cell.textContent?.trim() ?? "";
      values[columnIndex] = cellValue;
      for (let offset = 1; offset < cell.colSpan; offset += 1) {
        values[columnIndex + offset] = "";
      }
      if (cell.colSpan > 1 || cell.rowSpan > 1) {
        merges.push({
          s: { r: rowIndex, c: columnIndex },
          e: { r: rowIndex + cell.rowSpan - 1, c: columnIndex + cell.colSpan - 1 },
        });
      }
      columnIndex += cell.colSpan;
    }
    return values;
  });
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const border = {
    top: { style: "thin" as const, color: { rgb: "D0D5DD" } },
    right: { style: "thin" as const, color: { rgb: "D0D5DD" } },
    bottom: { style: "thin" as const, color: { rgb: "D0D5DD" } },
    left: { style: "thin" as const, color: { rgb: "D0D5DD" } },
  };
  for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < matrix[rowIndex].length; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[address];
      if (!cell) continue;
      const isMetaSpacer = rowIndex < 3 && columnIndex < 12;
      const isMetaCell = rowIndex < 3 && columnIndex >= 12;
      const isHeader = rowIndex === 3;
      const isGeneratedKey = rowIndex > 3 && columnIndex === 0;
      const isNumberCell = rowIndex > 3 && (columnIndex === 4 || columnIndex === 5);
      const isMarkerCell = rowIndex > 3 && columnIndex >= 13;
      const marker = String(cell.v ?? "").trim().toUpperCase();
      cell.s = {
        font: {
          name: "Aptos",
          sz: 10,
          bold: isMetaCell || isHeader || isGeneratedKey || isMarkerCell,
          color: {
            rgb: isHeader ? "FFFFFF"
              : isGeneratedKey ? "175CD3"
              : isMarkerCell && marker === "O" ? "067647"
              : isMarkerCell && marker === "X" ? "B42318"
              : "344054",
          },
        },
        fill: {
          patternType: "solid",
          fgColor: {
            rgb: isHeader ? "101828"
              : isMetaCell ? "F2F4F7"
              : isGeneratedKey ? "F9FAFB"
              : isMarkerCell && marker === "O" ? "ECFDF3"
              : isMarkerCell && marker === "X" ? "FEF3F2"
              : "FFFFFF",
          },
        },
        border: isMetaSpacer ? undefined : border,
        alignment: {
          vertical: "center",
          horizontal: isNumberCell || isMarkerCell ? "center" : "left",
        },
      };
    }
  }
  sheet["!merges"] = merges;
  sheet["!rows"] = matrix.map((_row, index) => ({ hpt: index === 3 ? 28 : 25 }));
  sheet["!cols"] = [
    { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 16 },
    { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
    { wch: 14 }, ...finalTable.value.layers.map(() => ({ wch: 10 })),
  ];
  if (matrix.length >= 4 && matrix[3]?.length) {
    sheet["!autofilter"] = { ref: `A4:${XLSX.utils.encode_col(matrix[3].length - 1)}${matrix.length}` };
  }
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
      <div v-if="graph.displayGraph" class="final-export-actions">
        <button class="primary final-export-primary" @click="exportFinalExcel"><Download :size="16"/>Overlay Key Excel</button>
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
              <th v-for="column in fixedColumns" :key="column.key">
                <span>{{ column.label }}</span>
                <button
                  type="button"
                  class="final-table-filter-button"
                  :class="{ active: isColumnActive(column.key) }"
                  :title="`${column.label} 필터 및 정렬`"
                  :aria-label="`${column.label} 필터 및 정렬`"
                  @click.stop="openFilter(column.key, $event)"
                >
                  <ArrowUpAZ v-if="sortState?.key === column.key && sortState.direction === 'asc'" :size="13"/>
                  <ArrowDownAZ v-else-if="sortState?.key === column.key && sortState.direction === 'desc'" :size="13"/>
                  <Filter v-else :size="13"/>
                </button>
              </th>
              <th v-for="layer in finalTable.layers" :key="`header-${layer.layerId}`">
                <span>{{ layer.number || "미지정" }}</span>
                <button
                  type="button"
                  class="final-table-filter-button"
                  :class="{ active: isColumnActive(`layer:${layer.layerId}`) }"
                  :title="`${layer.number || '미지정'} 필터 및 정렬`"
                  :aria-label="`${layer.number || '미지정'} 필터 및 정렬`"
                  @click.stop="openFilter(`layer:${layer.layerId}`, $event)"
                >
                  <ArrowUpAZ v-if="sortState?.key === `layer:${layer.layerId}` && sortState.direction === 'asc'" :size="13"/>
                  <ArrowDownAZ v-else-if="sortState?.key === `layer:${layer.layerId}` && sortState.direction === 'desc'" :size="13"/>
                  <Filter v-else :size="13"/>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in displayedRows" :key="row.relation.id">
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
            <tr v-if="!displayedRows.length">
              <td :colspan="13 + Math.max(1, finalTable.layers.length)" class="final-table-empty">
                {{ finalTable.rows.length ? "필터 조건에 맞는 Key가 없습니다." : "Relation 테이블에서 Relation을 생성하면 Key 행이 표시됩니다." }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-else class="empty-page">Overlay Key 데이터를 불러오는 중입니다.</div>

    <div v-if="activeFilterKey" class="final-table-filter-backdrop" @click="closeFilter"/>
    <section
      v-if="activeFilterKey"
      class="final-table-filter-menu"
      :style="{ top: `${filterMenuPosition.top}px`, left: `${filterMenuPosition.left}px` }"
      @click.stop
    >
      <div class="final-table-filter-heading">
        <strong>필터 및 정렬</strong>
        <button type="button" title="닫기" aria-label="필터 닫기" @click="closeFilter"><CloseIcon :size="16"/></button>
      </div>
      <button type="button" class="final-table-sort-option" @click="sortBy('asc')">
        <ArrowUpAZ :size="16"/><span>오름차순 정렬</span>
      </button>
      <button type="button" class="final-table-sort-option" @click="sortBy('desc')">
        <ArrowDownAZ :size="16"/><span>내림차순 정렬</span>
      </button>
      <div class="final-table-filter-divider"/>
      <label class="final-table-filter-search">
        <Search :size="15"/>
        <input v-model="filterSearch" placeholder="값 검색">
      </label>
      <div class="final-table-filter-tools">
        <button type="button" @click="selectAllFilterValues">모두 선택</button>
        <button type="button" @click="clearFilterValues">선택 해제</button>
      </div>
      <div class="final-table-filter-values">
        <label v-for="option in searchedFilterValues" :key="option">
          <input type="checkbox" :checked="filterDraft.includes(option)" @change="toggleFilterValue(option)">
          <span>{{ filterLabel(option) }}</span>
        </label>
        <p v-if="!searchedFilterValues.length">검색 결과가 없습니다.</p>
      </div>
      <div class="final-table-filter-actions">
        <button type="button" @click="clearCurrentFilter">필터 해제</button>
        <button type="button" class="primary" @click="applyFilter">적용</button>
      </div>
    </section>
  </section>
</template>
