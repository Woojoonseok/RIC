<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { AlertTriangle, CheckCircle2, MessageSquare, Pencil, Play, Plus, Settings2, Trash2, X } from "@lucide/vue";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import { useAppStore } from "../stores/app";
import { useGraphStore } from "../stores/graph";
import { useProjectStore } from "../stores/project";
import type { ValidationIssue, ValidationRule, ValidationRuleInput, ValidationRuleTarget } from "../types";

const router = useRouter();
const app = useAppStore();
const graph = useGraphStore();
const project = useProjectStore();
const rules = ref<ValidationRule[]>([]);
const rulesLoading = ref(true);
const rulesError = ref("");
const editorOpen = ref(false);
const editingId = ref<string | null>(null);

const targetOptions = [
  { value: "layer", label: "Layer" },
  { value: "relation", label: "Relation" },
  { value: "align_tree", label: "Editor" },
] as const;
const ruleOptions = [
  { value: "required", label: "필수값" },
  { value: "allowed_values", label: "허용값" },
  { value: "unique", label: "중복 금지" },
] as const;
const fields: Record<ValidationRuleTarget, { value: string; label: string }[]> = {
  layer: [
    { value: "name", label: "Layer 명" }, { value: "step", label: "Layer 번호" }, { value: "color", label: "Color" },
    { value: "mask_main_fld", label: "Mask MAIN FLD" }, { value: "mask_sl_fld", label: "Mask SL FLD" },
    { value: "pr_wf", label: "Mask PR" }, { value: "dev_wf", label: "WF Dev" },
    { value: "pr_type", label: "WF PR 종류" }, { value: "light_source", label: "광원" },
    { value: "pr_open_close", label: "PR Open/Close" }, { value: "group", label: "Group" },
    { value: "validation_rule", label: "검증 Rule" }, { value: "comment", label: "Comment" },
  ],
  relation: [
    { value: "relation_type", label: "Relation Type" }, { value: "key_priority", label: "Key Priority" },
    { value: "priority_rule", label: "Priority Rule" }, { value: "final_type", label: "Final Type" },
    { value: "key_purpose", label: "Key Purpose" }, { value: "placement", label: "Placement" },
    { value: "stack_type", label: "Stack Type" }, { value: "inregi", label: "Inregi" },
    { value: "inner_size", label: "Inner Size" }, { value: "outer_size", label: "Outer Size" },
  ],
  align_tree: [{ value: "process_name", label: "Process Name" }, { value: "gds_name", label: "GDS Name" }],
};

const draft = reactive({
  name: "", target_type: "layer" as ValidationRuleTarget, rule_type: "required" as ValidationRuleInput["rule_type"],
  field_name: "name", allowedValues: "", severity: "error" as ValidationRuleInput["severity"],
  message: "", enabled: true, sort_order: 0,
});
const availableFields = computed(() => fields[draft.target_type]);
const canManageRules = computed(() => project.canEditProject && project.leaseState === "held");
const errorCount = computed(() => graph.rawGraph?.validation.issues.filter((row) => row.severity === "error").length ?? 0);
const warningCount = computed(() => graph.rawGraph?.validation.issues.filter((row) => row.severity === "warning").length ?? 0);

function resetDraft(rule?: ValidationRule) {
  editingId.value = rule?.id ?? null;
  draft.name = rule?.name ?? "";
  draft.target_type = rule?.target_type ?? "layer";
  draft.rule_type = rule?.rule_type ?? "required";
  draft.field_name = rule?.field_name ?? fields[draft.target_type][0].value;
  draft.allowedValues = rule?.expected_values.join(", ") ?? "";
  draft.severity = rule?.severity ?? "error";
  draft.message = rule?.message ?? "";
  draft.enabled = rule?.enabled ?? true;
  draft.sort_order = rule?.sort_order ?? rules.value.length;
}
function openEditor(rule?: ValidationRule) { resetDraft(rule); editorOpen.value = true }
function closeEditor() { editorOpen.value = false; editingId.value = null }
function payload(): ValidationRuleInput {
  return {
    name: draft.name.trim(), target_type: draft.target_type, rule_type: draft.rule_type,
    field_name: draft.field_name,
    expected_values: draft.rule_type === "allowed_values" ? draft.allowedValues.split(",").map((value) => value.trim()).filter(Boolean) : [],
    severity: draft.severity, message: draft.message.trim() || null, enabled: draft.enabled, sort_order: draft.sort_order,
  };
}

async function loadRules() {
  if (!project.currentProjectId) { rules.value = []; return }
  rulesLoading.value = true;
  rulesError.value = "";
  try { rules.value = await app.run("검증 규칙 불러오기", () => api.validationRules()) }
  catch (error) { rulesError.value = error instanceof Error ? error.message : "검증 규칙을 불러오지 못했습니다." }
  finally { rulesLoading.value = false }
}
async function validate() {
  if (!project.currentTreeId) return;
  const report = await app.run("Validation", () => api.validate(project.currentTreeId));
  if (graph.rawGraph) graph.setGraph({ ...graph.rawGraph, validation: report });
}
async function saveRule() {
  if (!draft.name.trim() || (draft.rule_type === "allowed_values" && !payload().expected_values.length)) return;
  project.markSaving();
  try {
    const body = payload();
    const saved = await app.run(editingId.value ? "검증 규칙 수정" : "검증 규칙 추가", () => (
      editingId.value ? api.updateValidationRule(editingId.value, body) : api.createValidationRule(body)
    ));
    rules.value = editingId.value
      ? rules.value.map((row) => row.id === saved.id ? saved : row)
      : [...rules.value, saved];
    project.markSaved();
    closeEditor();
    await validate();
  } catch (error) { project.markSaveError(error); throw error }
}
async function toggleRule(rule: ValidationRule) {
  project.markSaving();
  try {
    const updated = await app.run("검증 규칙 상태 변경", () => api.updateValidationRule(rule.id, { ...rule, enabled: !rule.enabled }));
    rules.value = rules.value.map((row) => row.id === updated.id ? updated : row);
    project.markSaved();
    await validate();
  } catch (error) { project.markSaveError(error); throw error }
}
async function removeRule(rule: ValidationRule) {
  if (!window.confirm(`'${rule.name}' 규칙을 삭제할까요?`)) return;
  project.markSaving();
  try {
    await app.run("검증 규칙 삭제", () => api.deleteValidationRule(rule.id));
    rules.value = rules.value.filter((row) => row.id !== rule.id);
    project.markSaved();
    await validate();
  } catch (error) { project.markSaveError(error); throw error }
}
async function focus(issue: ValidationIssue) {
  if (issue.layer_id) app.select({ kind: "layer", id: issue.layer_id });
  else if (issue.relation_id) app.select({ kind: "relation", id: issue.relation_id });
  else return;
  await router.push({ name: "tree-editor", params: { projectId: project.currentProjectId, treeId: project.currentTreeId } });
}
function reviewIssue(issue: ValidationIssue, index: number) {
  app.openReview({
    target_type: "validation_issue",
    target_key: `${issue.code}:${issue.rule_id || "builtin"}:${issue.layer_id || issue.relation_id || index}`,
    target_label: `Validation · ${issue.rule_name || issue.code}`,
  });
}
function targetLabel(value: ValidationRuleTarget) { return targetOptions.find((row) => row.value === value)?.label ?? value }
function ruleLabel(value: ValidationRuleInput["rule_type"]) { return ruleOptions.find((row) => row.value === value)?.label ?? value }
function fieldLabel(rule: ValidationRule) { return fields[rule.target_type].find((row) => row.value === rule.field_name)?.label ?? rule.field_name }

watch(() => draft.target_type, () => {
  if (!availableFields.value.some((field) => field.value === draft.field_name)) draft.field_name = availableFields.value[0].value;
});
watch(() => project.currentProjectId, () => void loadRules());
onMounted(loadRules);
</script>

<template>
  <section class="page validation-page">
    <div class="page-title">
      <div><p class="eyebrow">DESIGN INTEGRITY</p><h1>Validation</h1><p>저장된 Editor 데이터를 기본 규칙과 프로젝트 규칙으로 검사합니다.</p></div>
      <div class="validation-title-actions">
        <button :disabled="!canManageRules" @click="openEditor()"><Plus :size="16"/> 규칙 추가</button>
        <button class="primary" :disabled="!project.currentTreeId" @click="validate"><Play :size="16"/> 검증 실행</button>
      </div>
    </div>

    <div v-if="graph.rawGraph" class="validation-layout">
      <section class="validation-rules-section">
        <div class="validation-section-heading">
          <div><Settings2 :size="18"/><h2>프로젝트 검증 규칙</h2><span>{{ rules.length }}</span></div>
          <small>오류 규칙을 위반하면 검토 요청이 제한됩니다.</small>
        </div>
        <div class="validation-rule-list">
          <p v-if="rulesLoading" class="empty">검증 규칙을 불러오는 중입니다.</p>
          <p v-else-if="rulesError" class="empty">{{ rulesError }} <button @click="loadRules">다시 시도</button></p>
          <p v-else-if="!rules.length" class="empty">추가된 프로젝트 규칙이 없습니다.</p>
          <article v-for="rule in rules" :key="rule.id" class="validation-rule-row" :class="{ disabled: !rule.enabled }">
            <button class="rule-toggle" :class="{ on: rule.enabled }" :disabled="!canManageRules" :aria-label="`${rule.name} ${rule.enabled ? '끄기' : '켜기'}`" @click="toggleRule(rule)"><span/></button>
            <div class="validation-rule-copy"><strong>{{ rule.name }}</strong><p>{{ targetLabel(rule.target_type) }} · {{ fieldLabel(rule) }} · {{ ruleLabel(rule.rule_type) }}<template v-if="rule.expected_values.length"> · {{ rule.expected_values.join(', ') }}</template></p></div>
            <span class="rule-severity" :class="rule.severity">{{ rule.severity === "error" ? "오류" : "경고" }}</span>
            <button class="rule-icon-button" title="규칙 수정" :disabled="!canManageRules" @click="openEditor(rule)"><Pencil :size="15"/></button>
            <button class="rule-icon-button danger" title="규칙 삭제" :disabled="!canManageRules" @click="removeRule(rule)"><Trash2 :size="15"/></button>
          </article>
        </div>
      </section>

      <section class="panel validation-summary" :class="graph.rawGraph.validation.ok ? 'ok' : 'error'">
        <span><CheckCircle2 v-if="graph.rawGraph.validation.ok" :size="24"/><AlertTriangle v-else :size="24"/></span>
        <div><strong>{{ graph.rawGraph.validation.ok ? '검증을 통과했습니다' : '확인이 필요한 항목이 있습니다' }}</strong><p>오류 {{ errorCount }} · 경고 {{ warningCount }}</p></div>
      </section>
      <section class="panel validation-results">
        <article v-for="(issue, index) in graph.rawGraph.validation.issues" :key="`${issue.code}-${index}`" class="issue-row" :class="issue.severity">
          <b>{{ issue.severity === "error" ? "오류" : "경고" }}</b><span><strong>{{ issue.rule_name || issue.code }}</strong><small>{{ issue.message }}</small></span><div class="issue-actions"><button v-if="issue.layer_id || issue.relation_id" @click="focus(issue)">Canvas에서 보기</button><button title="이슈 리뷰" @click="reviewIssue(issue, index)"><MessageSquare :size="15"/>리뷰</button></div>
        </article>
        <p v-if="!graph.rawGraph.validation.issues.length" class="empty">발견된 문제가 없습니다.</p>
      </section>
    </div>
    <div v-else class="empty-page">프로젝트를 선택하세요.</div>

    <div v-if="editorOpen" class="paste-overlay" @click="closeEditor">
      <section class="panel paste-panel validation-rule-editor" @click.stop>
        <div class="panel-heading"><div><p class="eyebrow">VALIDATION RULE</p><h2>{{ editingId ? '검증 규칙 수정' : '검증 규칙 추가' }}</h2></div><button class="rule-icon-button" title="닫기" @click="closeEditor"><X :size="18"/></button></div>
        <div class="validation-rule-form">
          <label class="wide"><span>규칙 이름</span><input v-model="draft.name" autofocus maxlength="160" placeholder="예: Mask MAIN FLD 필수"></label>
          <label><span>대상</span><select v-model="draft.target_type"><option v-for="option in targetOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          <label><span>필드</span><select v-model="draft.field_name"><option v-for="field in availableFields" :key="field.value" :value="field.value">{{ field.label }}</option></select></label>
          <label><span>검사 방식</span><select v-model="draft.rule_type"><option v-for="option in ruleOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
          <label><span>결과 등급</span><select v-model="draft.severity"><option value="error">오류</option><option value="warning">경고</option></select></label>
          <label v-if="draft.rule_type === 'allowed_values'" class="wide"><span>허용값</span><input v-model="draft.allowedValues" placeholder="쉼표로 구분: A, B, C"></label>
          <label class="wide"><span>메시지</span><input v-model="draft.message" maxlength="500" placeholder="선택 사항 · {target}, {field}, {value} 사용 가능"></label>
          <label class="rule-enabled"><input v-model="draft.enabled" type="checkbox"><span>저장 후 바로 적용</span></label>
        </div>
        <div class="validation-rule-actions"><button @click="closeEditor">취소</button><button class="primary" :disabled="!draft.name.trim() || (draft.rule_type === 'allowed_values' && !draft.allowedValues.trim())" @click="saveRule">{{ editingId ? '수정 저장' : '규칙 추가' }}</button></div>
      </section>
    </div>
  </section>
</template>
