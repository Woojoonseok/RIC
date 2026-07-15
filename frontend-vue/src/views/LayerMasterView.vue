<script setup lang="ts">
import { computed, onMounted } from "vue";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import { useReferenceStore } from "../stores/reference";
import type { LayerMaster, LayerMasterCreate } from "../types";
const app = useAppStore(); const graph = useGraphStore(); const project = useProjectStore();
const reference = useReferenceStore();
const layouts = computed(() => reference.keyLayoutTypes); const masters = computed(() => reference.layerMasters);
const blank = (): LayerMaster => ({ id: "", name: "", layer_number: null, mask_main_fld: null, mask_sl_fld: null, pr_wf: null, dev_wf: null, pr_type: null, light_source: null, pr_open_close: null, validation_rule: null, comment: null, priorities: {} });
const rows = computed(() => masters.value);
async function load() { await reference.loadAll() }
async function save(row: LayerMaster) { const { id, ...body } = row; if (id) await api.updateLayerMaster(id, body); else await api.createLayerMaster(body as LayerMasterCreate); await load() }
async function remove(row: LayerMaster) { if (!row.id || !confirm("Layer Master를 삭제할까요?")) return; await api.deleteLayerMaster(row.id); await load() }
async function createLayer(row: LayerMaster) { if (!project.projectId) return alert("프로젝트를 먼저 선택하세요."); const snapshot = structuredClone(row); await graph.mutateGraph("Master에서 Layer 생성", () => api.createLayer(project.projectId, { name: row.name, step: row.layer_number, metadata_json: { layer_master: snapshot } })); app.view = "editor" }
onMounted(load);
</script>
<template><section class="page wide-page"><div class="page-title"><div><p class="eyebrow">PROCESS SOURCE OF TRUTH</p><h1>Layer 정보</h1><p>Key Layout Type에 따라 우선순위 컬럼이 자동으로 확장됩니다.</p></div><button class="primary" @click="masters.push(blank())">Layer Master 추가</button></div><div class="panel master-scroll"><table class="master-table"><thead><tr><th>Layer 명</th><th>Layer 번호</th><th>Mask MAIN FLD</th><th>Mask SL FLD</th><th>Mask PR</th><th>WF Dev</th><th>WF PR종류</th><th>광원</th><th>PR Open/Close</th><th v-for="layout in layouts" :key="layout.id">우선순위 {{ layout.name }}</th><th>검증 Rule</th><th>Comment</th><th>작업</th></tr></thead><tbody><tr v-for="(row, index) in rows" :key="row.id || index"><td><input v-model="row.name"></td><td><input v-model="row.layer_number"></td><td><input v-model="row.mask_main_fld"></td><td><input v-model="row.mask_sl_fld"></td><td><input v-model="row.pr_wf"></td><td><input v-model="row.dev_wf"></td><td><input v-model="row.pr_type"></td><td><input v-model="row.light_source"></td><td><input v-model="row.pr_open_close"></td><td v-for="layout in layouts" :key="layout.id"><input v-model="row.priorities[layout.id]"></td><td><input v-model="row.validation_rule"></td><td><input v-model="row.comment"></td><td><div class="stack-actions"><button @click="save(row)">저장</button><button :disabled="!row.id" @click="createLayer(row)">Layer 생성</button><button class="danger" :disabled="!row.id" @click="remove(row)">삭제</button></div></td></tr></tbody></table><p v-if="!rows.length" class="empty">Layer Master를 추가하세요.</p></div></section></template>
