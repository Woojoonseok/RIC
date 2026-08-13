import type { AuditEvent } from "../types";

const targetLabels: Record<string, string> = {
  project: "프로젝트",
  align_tree: "Align Tree",
  key_layout_type: "Key Layout Type",
  key_drawing_type: "Key Drawing Type",
  key_shape: "Key Shape",
  relation_style: "Arrow Style",
  box_preset: "Box Preset",
  layer_master: "Layer 정보",
  layer: "Layer",
  relation: "Layer Relation",
  text_box: "Text Box",
  member: "멤버",
  access_request: "권한 신청",
};

const fieldLabels: Record<string, string> = {
  name: "이름",
  color: "Layer 이름 색상",
  description: "설명",
  text: "내용",
  symbol: "기호",
  key_shape: "Key Shape",
  drawing_guide: "Drawing Guide",
  scribe_lane_rows: "Scribe lane 행",
  sort_order: "정렬 순서",
  step: "Layer 번호",
  layer_number: "Layer 번호",
  layer_property: "Property",
  align: "Align",
  align_side: "Align Side",
  pending_group: "Group",
  group: "Group",
  comment: "Comment",
  validation_rule: "Validation Rule",
  x: "X",
  y: "Y",
  width: "너비",
  height: "높이",
  fill_color: "채우기 색상",
  stroke_color: "선 색상",
  text_color: "글자 색상",
  font_size: "글자 크기",
  stroke_width: "선 굵기",
  source_port: "Source Port",
  target_port: "Target Port",
  relation_type: "Relation Type",
  parent_layer_id: "Parent Layer",
  child_layer_id: "Child Layer",
  key_layout_type_id: "Key 배치",
  key_drawing_type_id: "Key Type",
  parent_drawing_type_id: "Parent Drawing",
  child_drawing_type_id: "Child Drawing",
  key_priority: "Key 우선순위",
  priority_rule: "우선순위 Rule",
  final_type: "Type",
  key_purpose: "key목적",
  placement: "Placement",
  stack_type: "Stack종류",
  inregi: "INREGI여부",
  inner_size: "Inner Size",
  outer_size: "Outer Size",
  requested_role: "요청 권한",
  role: "권한",
  priorities: "우선순위",
  background_color: "배경 색상",
  shape_type: "도형 유형",
  border_color: "테두리 색상",
  locked: "잠금",
};

const directTitles: Record<string, string> = {
  "project.created": "프로젝트 생성",
  "project.updated": "프로젝트 정보 수정",
  "project.deleted": "프로젝트 삭제",
  "project.legacy_claimed": "기존 프로젝트 가져오기",
  "project.migrated_v2": "프로젝트 데이터 마이그레이션",
  "align_tree.created": "Align Tree 생성",
  "align_tree.updated": "Align Tree 정보 수정",
  "align_tree.deleted": "Align Tree 삭제",
  "layer.created": "Layer 추가",
  "layer.updated": "Layer 정보 수정",
  "layer.deleted": "Layer 삭제",
  "layer.group_updated": "Layer Group 수정",
  "layers.merged": "Layer 병합",
  "layers.split": "Layer 분리",
  "layout.updated": "Layer 위치·크기 수정",
  "style.updated": "Layer 스타일 수정",
  "relation.created": "Layer Relation 추가",
  "relation.imported": "Layer Relation 일괄 가져오기",
  "layer_master.imported": "Layer 정보 일괄 가져오기",
  "relation.updated": "Layer Relation 수정",
  "relation.deleted": "Layer Relation 삭제",
  "text_box.created": "Text Box 추가",
  "text_box.updated": "Text Box 수정",
  "text_box.deleted": "Text Box 삭제",
  "graph.batch_updated": "여러 그래프 항목 수정",
  "graph.auto_layout": "자동 배치 적용",
  "graph.restored": "Align Tree 그래프 복원",
  "snapshot.created": "Editor 스냅샷 저장",
  "snapshot.restored": "Editor 스냅샷 복원",
  "snapshot.deleted": "Editor 스냅샷 삭제",
  "workflow.in_review": "Editor 검토 요청",
  "workflow.draft": "Editor 초안 전환",
  "workflow.approved": "Editor 승인",
  "workflow.published": "Editor 공식 배포",
  "member.added": "프로젝트 멤버 추가",
  "member.role_changed": "프로젝트 멤버 권한 수정",
  "member.removed": "프로젝트 멤버 제거",
  "access.requested": "프로젝트 권한 신청",
  "access.approved": "프로젝트 권한 신청 승인",
  "access.rejected": "프로젝트 권한 신청 거절",
};

function details(event: AuditEvent): Record<string, unknown> {
  return event.details_json ?? event.payload ?? {};
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function actionTitle(type: string) {
  if (type.endsWith(".created")) return "추가";
  if (type.endsWith(".updated")) return "수정";
  if (type.endsWith(".deleted")) return "삭제";
  return "변경";
}

function resourceName(event: AuditEvent) {
  const data = details(event);
  const candidate = record(data.after) ?? record(data.values) ?? record(data.before);
  const name = candidate?.name ?? candidate?.key_shape ?? candidate?.symbol;
  if (name != null && String(name).trim()) return String(name);
  const summary = event.summary ?? "";
  for (const prefix of ["Updated layer ", "Created layer ", "Deleted layer ", "Updated Layer Master ", "Created Layer Master ", "Deleted Layer Master "]) {
    if (summary.startsWith(prefix)) return summary.slice(prefix.length);
  }
  return "";
}

export function isChangeAuditEvent(event: AuditEvent) {
  const type = String(event.event_type ?? event.action ?? "");
  if (type.startsWith("lease.") || type.startsWith("project.migrated")) return false;
  return auditEventChanges(event).length > 0;
}

export function auditActorName(event: AuditEvent) {
  return event.actor?.display_name || event.actor_label_snapshot || event.actor_display_name || "시스템";
}

export function auditEventTitle(event: AuditEvent) {
  const type = String(event.event_type ?? event.action ?? "");
  let title = directTitles[type];
  if (!title && type.startsWith("reference.")) {
    title = `${targetLabels[event.target_type ?? ""] ?? "기준정보"} ${actionTitle(type)}`;
  } else if (!title && type.startsWith("layer_master.")) {
    title = `Layer 정보 ${actionTitle(type)}`;
  }
  if (!title) title = `${targetLabels[event.target_type ?? event.entity_type ?? ""] ?? "데이터"} 변경`;
  const name = resourceName(event);
  return name ? `${title} · ${name}` : title;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "비어 있음";
  if (typeof value === "boolean") return value ? "사용" : "미사용";
  if (typeof value === "object") {
    const serialized = JSON.stringify(value);
    return serialized.length > 42 ? `${serialized.slice(0, 39)}…` : serialized;
  }
  const text = String(value);
  return text.length > 42 ? `${text.slice(0, 39)}…` : text;
}

export function auditEventChanges(event: AuditEvent) {
  const data = details(event);
  const type = String(event.event_type ?? event.action ?? "");
  const before = record(data.before);
  const after = record(data.after);
  if (before && after) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys
      .filter((key) => !sameValue(before[key], after[key]))
      .slice(0, 5)
      .map((key) => `${fieldLabels[key] ?? key}: ${formatValue(before[key])} → ${formatValue(after[key])}`);
  }
  if ("before" in data && "after" in data && !sameValue(data.before, data.after)) {
    return [`변경: ${formatValue(data.before)} → ${formatValue(data.after)}`];
  }
  if (type.endsWith(".created") || type.endsWith(".deleted") || type === "member.added" || type === "member.removed") {
    const snapshot = record(data.values) ?? record(data);
    if (snapshot) {
      const entries = Object.entries(snapshot)
        .filter(([key, value]) => !["before", "after", "values"].includes(key) && value !== null && value !== undefined && value !== "")
        .slice(0, 5);
      return entries.map(([key, value]) => type.endsWith(".deleted") || type === "member.removed"
        ? `${fieldLabels[key] ?? key}: ${formatValue(value)} → 삭제됨`
        : `${fieldLabels[key] ?? key}: 없음 → ${formatValue(value)}`);
    }
  }
  if (type === "layers.merged" && data.group) {
    return [`Group: 없음 → ${formatValue(data.group)}`];
  }
  if (type === "layers.split" && Array.isArray(data.groups) && data.groups.length) {
    return [`Group: ${data.groups.map(formatValue).join(", ")} → 해제됨`];
  }
  if (type === "layers.split" && Number(data.layer_count ?? 0) > 0) {
    return [`Layer: 병합 상태 → ${Number(data.layer_count)}개로 분리`];
  }
  if (type === "graph.restored") {
    return ["Align Tree 그래프: 현재 상태 → 선택한 복원 상태"];
  }
  return [];
}
