import type {
  AlignKeyRow, AlignKeyRowCreate, AlignKeyRowUpdate, AlignTree, AlignTreeCreate, AnonymousSession, AuditEvent, AutoLayoutRequest, BoxPreset, EditLease, Graph, GraphBatchUpdate,
  GraphRestore, KeyDrawingType, KeyLayoutType, KeyShape, Layer, LayerCreate, LayerMaster, LayerMasterCreate,
  LayerMasterImportCommitResult, LayerMasterImportPreview, LayerMasterImportRequest, LayerMasterUpdate,
  LayerImpactReport, LayerMergeRequest, LayerSplitRequest, LayerUpdate, Layout, LayoutUpdate, Project,
  ProjectAccessRequest, ProjectCreate, ProjectMember, ProjectRole, ProjectUpdate, ReferenceCreateMap,
  ReferenceReadMap, ReferenceResource, ReferenceUpdateMap, Relation, RelationCreate, RelationImpactReport, RelationStyle,
  RelationImportCommitResult, RelationImportPreview, RelationImportRequest, RelationUpdate, ShapeStyle, StyleUpdate, TextBox, TextBoxCreate, TextBoxUpdate, ValidationReport, ValidationRule, ValidationRuleInput,
  ReviewAttachmentInput, ReviewNotification, ReviewThread, ReviewThreadCreate, SnapshotCreate, SnapshotDetail, SnapshotDiff, SnapshotSummary,
  UserSummary,
} from "../types";

// Same-origin by default: Vite proxies /api in development and production is
// expected to route /api to FastAPI. This keeps LAN access cookie/CORS-safe.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export function describeErrorDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(describeErrorDetail).filter(Boolean).join("; ");
  if (detail && typeof detail === "object") {
    const row = detail as Record<string, unknown>;
    if (typeof row.msg === "string") {
      const location = Array.isArray(row.loc) ? row.loc.join(".") : "";
      return location ? `${location}: ${row.msg}` : row.msg;
    }
    if (typeof row.message === "string") return row.message;
    try { return JSON.stringify(detail) } catch { return String(detail) }
  }
  return detail == null ? "" : String(detail);
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) { super(message); this.name = "ApiError" }
}

interface WorkspaceRequestContext {
  projectId: string;
  treeId: string;
  leaseToken: string | null;
  revision: number | null;
  readOnly: boolean;
}
let contextProvider: (() => WorkspaceRequestContext) | null = null;
let revisionListener: ((projectId: string, revision: number) => void) | null = null;

export function configureProjectRequestContext(provider: () => WorkspaceRequestContext, onRevision: (projectId: string, revision: number) => void) {
  contextProvider = provider;
  revisionListener = onRevision;
}

function context() { return contextProvider?.() ?? null }
function requestProjectId(path: string) {
  const match = /^\/projects\/([^/?]+)/.exec(path);
  return match ? decodeURIComponent(match[1]) : null;
}
function projectRoot(projectId = context()?.projectId) {
  if (!projectId) throw new ApiError(400, "프로젝트를 먼저 선택하세요.");
  return `/projects/${projectId}`;
}
function treeRoot(treeId: string, projectId = context()?.projectId) {
  return `${projectRoot(projectId)}/align-trees/${treeId}`;
}
function graphRoot(treeId: string) { return `${treeRoot(treeId)}/graph` }
function referenceRoot() { return `${projectRoot()}/reference` }
function layerMasterRoot() { return `${projectRoot()}/layer-master` }

function requestNeedsProjectLease(path: string, method: string, active: WorkspaceRequestContext | null) {
  if (!active?.projectId || method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (!path.startsWith(`/projects/${active.projectId}`)) return false;
  if (/\/(?:lease|claim-legacy)$/.test(path) || /\/(?:access-requests|members|audit-events|review-threads)(?:\/|$|\?)/.test(path) || /\/validate$/.test(path)) return false;
  return true;
}
function isWorkflowTransition(path: string) {
  return /\/align-trees\/[^/?]+\/workflow\/(?:request-review|reject|approve|publish|reopen)$/.test(path);
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const active = context();
  if (requestNeedsProjectLease(path, method, active)) {
    if (active?.readOnly && (!isWorkflowTransition(path) || !active.leaseToken)) throw new ApiError(403, "현재 프로젝트는 보기 전용입니다.");
    if (active?.leaseToken) headers.set("X-Edit-Lease", active.leaseToken);
    if (active?.revision !== null && active?.revision !== undefined) headers.set("If-Match", `"${active.revision}"`);
  }
  const response = await fetch(`${API_BASE}${path}`, { ...options, credentials: "include", headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = describeErrorDetail(body?.detail);
    throw new ApiError(response.status, detail || `${response.status} ${response.statusText}`, body?.detail);
  }
  const revisionHeader = response.headers.get("X-Project-Revision");
  const revision = revisionHeader === null ? Number.NaN : Number(revisionHeader);
  const responseProjectId = requestProjectId(path);
  if (responseProjectId && revisionHeader !== null && Number.isFinite(revision)) revisionListener?.(responseProjectId, revision);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

const json = <T>(method: string, body?: T): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface AuditEventQuery {
  limit?: number;
  changesOnly?: boolean;
  alignTreeId?: string;
  targetId?: string;
  eventPrefixes?: string[];
}

function auditEventPath(projectId: string, options: AuditEventQuery = {}) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.changesOnly) params.set("changes_only", "true");
  if (options.alignTreeId) params.set("align_tree_id", options.alignTreeId);
  if (options.targetId) params.set("target_id", options.targetId);
  for (const prefix of options.eventPrefixes ?? []) params.append("event_prefix", prefix);
  return `/projects/${projectId}/audit-events?${params.toString()}`;
}

export const api = {
  me: () => request<AnonymousSession>("/me"),
  updateMe: (displayName: string) => request<AnonymousSession>("/me", json("PATCH", { display_name: displayName })),

  listProjects: () => request<Project[]>("/projects"),
  createProject: (body: ProjectCreate) => request<Project>("/projects", json("POST", body)),
  branchProject: (id: string, body: ProjectCreate) => request<Project>(`/projects/${id}/branch`, json("POST", body)),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  updateProject: (id: string, body: ProjectUpdate) => request<Project>(`/projects/${id}`, json("PATCH", body)),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, json("DELETE")),
  claimLegacyProject: (id: string) => request<Project>(`/projects/${id}/claim-legacy`, json("POST")),

  requestProjectAccess: (id: string, requestedRole: "viewer" | "editor", message?: string) => request<ProjectAccessRequest>(`/projects/${id}/access-requests`, json("POST", { requested_role: requestedRole, message: message || null })),
  listProjectAccessRequests: (id: string) => request<ProjectAccessRequest[]>(`/projects/${id}/access-requests`),
  reviewProjectAccessRequest: (projectId: string, requestId: string, status: "approved" | "rejected", role?: ProjectRole) => request<ProjectAccessRequest>(`/projects/${projectId}/access-requests/${requestId}`, json("PATCH", { status, role })),
  listProjectMembers: (id: string) => request<ProjectMember[]>(`/projects/${id}/members`),
  searchUsers: (projectId: string, query: string) => request<UserSummary[]>(`/projects/${projectId}/users?query=${encodeURIComponent(query)}`),
  addProjectMember: (projectId: string, actorId: string, role: ProjectRole) => request<ProjectMember>(`/projects/${projectId}/members`, json("POST", { actor_id: actorId, role })),
  updateProjectMember: (projectId: string, actorId: string, role: ProjectRole) => request<ProjectMember>(`/projects/${projectId}/members/${actorId}`, json("PATCH", { role })),
  removeProjectMember: (projectId: string, actorId: string) => request<void>(`/projects/${projectId}/members/${actorId}`, json("DELETE")),
  projectAuditEvents: (id: string, options: AuditEventQuery = {}) => request<AuditEvent[]>(auditEventPath(id, options)),

  listAlignTrees: (id: string) => request<AlignTree[]>(`/projects/${id}/align-trees`),
  alignKeyRows: (projectId: string) => request<AlignKeyRow[]>(`/projects/${projectId}/align-key-rows`),
  createAlignKeyRow: (projectId: string, body: AlignKeyRowCreate) => request<AlignKeyRow>(`/projects/${projectId}/align-key-rows`, json("POST", body)),
  updateAlignKeyRow: (projectId: string, id: string, body: AlignKeyRowUpdate) => request<AlignKeyRow>(`/projects/${projectId}/align-key-rows/${id}`, json("PUT", body)),
  deleteAlignKeyRow: (projectId: string, id: string) => request<void>(`/projects/${projectId}/align-key-rows/${id}`, json("DELETE")),
  createAlignTree: (id: string, body: AlignTreeCreate) => request<AlignTree>(`/projects/${id}/align-trees`, json("POST", body)),
  getAlignTree: (projectId: string, treeId: string) => request<AlignTree>(`/projects/${projectId}/align-trees/${treeId}`),
  updateAlignTree: (projectId: string, treeId: string, body: Partial<AlignTreeCreate>) => request<AlignTree>(`/projects/${projectId}/align-trees/${treeId}`, json("PATCH", body)),
  deleteAlignTree: (projectId: string, treeId: string) => request<void>(`/projects/${projectId}/align-trees/${treeId}`, json("DELETE")),
  requestWorkflowReview: (treeId: string, note: string) => request<AlignTree>(`${treeRoot(treeId)}/workflow/request-review`, json("POST", { note })),
  rejectWorkflowReview: (treeId: string, note: string) => request<AlignTree>(`${treeRoot(treeId)}/workflow/reject`, json("POST", { note })),
  approveWorkflowReview: (treeId: string, note: string) => request<AlignTree>(`${treeRoot(treeId)}/workflow/approve`, json("POST", { note })),
  publishWorkflow: (treeId: string, note: string) => request<AlignTree>(`${treeRoot(treeId)}/workflow/publish`, json("POST", { note })),
  reopenWorkflowDraft: (treeId: string, note: string) => request<AlignTree>(`${treeRoot(treeId)}/workflow/reopen`, json("POST", { note })),

  acquireLease: (projectId: string, clientInstanceId: string, force = false) => request<EditLease>(`/projects/${projectId}/lease`, json("POST", { client_instance_id: clientInstanceId, force })),
  heartbeatLease: (projectId: string, clientInstanceId: string, leaseToken: string) => request<EditLease>(`/projects/${projectId}/lease`, { ...json("PUT", { client_instance_id: clientInstanceId }), headers: { "X-Edit-Lease": leaseToken } }),
  releaseLease: (projectId: string, leaseToken: string, keepalive = false) => request<void>(`/projects/${projectId}/lease`, { method: "DELETE", headers: { "X-Edit-Lease": leaseToken }, keepalive }),

  getGraph: (treeId: string) => request<Graph>(graphRoot(treeId)),
  restoreGraph: (treeId: string, body: GraphRestore) => request<Graph>(`${graphRoot(treeId)}/restore`, json("PATCH", body)),
  batchGraph: (treeId: string, body: GraphBatchUpdate) => request<Graph>(`${graphRoot(treeId)}/batch`, json("PATCH", body)),
  validate: (treeId: string) => request<ValidationReport>(`${treeRoot(treeId)}/validate`, json("POST")),
  autoLayout: (treeId: string, body: AutoLayoutRequest) => request<Graph>(`${graphRoot(treeId)}/auto-layout`, json("POST", body)),
  createLayer: (treeId: string, body: LayerCreate) => request<Layer>(`${graphRoot(treeId)}/layers`, json("POST", body)),
  updateLayer: (treeId: string, id: string, body: LayerUpdate) => request<Layer>(`${graphRoot(treeId)}/layers/${id}`, json("PUT", body)),
  deleteLayer: (treeId: string, id: string) => request<void>(`${graphRoot(treeId)}/layers/${id}`, json("DELETE")),
  deletePreview: (treeId: string, id: string) => request<{ incoming: Relation[]; outgoing: Relation[] }>(`${graphRoot(treeId)}/layers/${id}/delete-preview`),
  layerImpact: (treeId: string, id: string) => request<LayerImpactReport>(`${graphRoot(treeId)}/layers/${id}/impact`),
  updateLayout: (treeId: string, id: string, body: LayoutUpdate) => request<Layout>(`${graphRoot(treeId)}/layers/${id}/layout`, json("PATCH", body)),
  updateStyle: (treeId: string, id: string, body: StyleUpdate) => request<ShapeStyle>(`${graphRoot(treeId)}/layers/${id}/style`, json("PATCH", body)),
  updateGroup: (treeId: string, id: string, group: string | null) => request<Graph>(`${graphRoot(treeId)}/layers/${id}/group`, json("PATCH", { group })),
  merge: (treeId: string, body: LayerMergeRequest) => request<Graph>(`${graphRoot(treeId)}/layers/merge`, json("POST", body)),
  split: (treeId: string, id: string, body: LayerSplitRequest = {}) => request<Graph>(`${graphRoot(treeId)}/layers/${id}/split`, json("POST", body)),
  createRelation: (treeId: string, body: RelationCreate) => request<Relation>(`${graphRoot(treeId)}/relations`, json("POST", body)),
  updateRelation: (treeId: string, id: string, body: RelationUpdate) => request<Relation>(`${graphRoot(treeId)}/relations/${id}`, json("PUT", body)),
  deleteRelation: (treeId: string, id: string) => request<void>(`${graphRoot(treeId)}/relations/${id}`, json("DELETE")),
  relationImpact: (treeId: string, id: string) => request<RelationImpactReport>(`${graphRoot(treeId)}/relations/${id}/impact`),
  previewRelationImport: (treeId: string, body: RelationImportRequest) => request<RelationImportPreview>(`${graphRoot(treeId)}/relations/import/preview`, json("POST", body)),
  commitRelationImport: (treeId: string, body: RelationImportRequest) => request<RelationImportCommitResult>(`${graphRoot(treeId)}/relations/import/commit`, json("POST", body)),
  createText: (treeId: string, body: TextBoxCreate) => request<TextBox>(`${graphRoot(treeId)}/text-boxes`, json("POST", body)),
  updateText: (treeId: string, id: string, body: TextBoxUpdate) => request<TextBox>(`${graphRoot(treeId)}/text-boxes/${id}`, json("PUT", body)),
  deleteText: (treeId: string, id: string) => request<void>(`${graphRoot(treeId)}/text-boxes/${id}`, json("DELETE")),
  listSnapshots: (treeId: string) => request<SnapshotSummary[]>(`${treeRoot(treeId)}/snapshots`),
  createSnapshot: (treeId: string, body: SnapshotCreate) => request<SnapshotSummary>(`${treeRoot(treeId)}/snapshots`, json("POST", body)),
  getSnapshot: (treeId: string, id: string) => request<SnapshotDetail>(`${treeRoot(treeId)}/snapshots/${id}`),
  compareSnapshot: (treeId: string, id: string, targetId?: string) => request<SnapshotDiff>(`${treeRoot(treeId)}/snapshots/${id}/compare${targetId ? `?target_snapshot_id=${encodeURIComponent(targetId)}` : ""}`),
  previewSnapshotRestore: (treeId: string, id: string) => request<SnapshotDiff>(`${treeRoot(treeId)}/snapshots/${id}/restore/preview`, json("POST")),
  restoreSnapshot: (treeId: string, id: string) => request<Graph>(`${treeRoot(treeId)}/snapshots/${id}/restore`, json("POST")),
  deleteSnapshot: (treeId: string, id: string) => request<void>(`${treeRoot(treeId)}/snapshots/${id}`, json("DELETE")),
  listReviewThreads: (projectId: string, treeId: string, status?: "open" | "resolved") => request<ReviewThread[]>(`/projects/${projectId}/review-threads?align_tree_id=${encodeURIComponent(treeId)}${status ? `&status=${status}` : ""}`),
  listReviewAssignees: (projectId: string) => request<UserSummary[]>(`/projects/${projectId}/review-threads/assignees`),
  createReviewThread: (projectId: string, body: ReviewThreadCreate) => request<ReviewThread>(`/projects/${projectId}/review-threads`, json("POST", body)),
  addReviewComment: (projectId: string, threadId: string, body: string, parentCommentId?: string | null, mentionedActorIds: string[] = [], attachments: ReviewAttachmentInput[] = []) => request<ReviewThread>(`/projects/${projectId}/review-threads/${threadId}/comments`, json("POST", { body, parent_comment_id: parentCommentId || null, mentioned_actor_ids: mentionedActorIds, attachments })),
  updateReviewThread: (projectId: string, threadId: string, body: { status?: "open" | "resolved"; assignee_actor_id?: string | null; assignee_set?: boolean }) => request<ReviewThread>(`/projects/${projectId}/review-threads/${threadId}`, json("PATCH", body)),
  listReviewNotifications: (projectId: string) => request<ReviewNotification[]>(`/projects/${projectId}/review-threads/notifications`),
  markReviewNotificationsRead: (projectId: string, notificationIds: string[] = []) => request<void>(`/projects/${projectId}/review-threads/notifications/read`, json("POST", { notification_ids: notificationIds })),

  keyLayoutTypes: () => request<KeyLayoutType[]>(`${referenceRoot()}/key-layout-types`),
  keyDrawingTypes: () => request<KeyDrawingType[]>(`${referenceRoot()}/key-drawing-types`),
  keyShapes: () => request<KeyShape[]>(`${referenceRoot()}/key-shapes`),
  relationStyles: () => request<RelationStyle[]>(`${referenceRoot()}/relation-styles`),
  boxPresets: () => request<BoxPreset[]>(`${referenceRoot()}/box-presets`),
  validationRules: () => request<ValidationRule[]>(`${referenceRoot()}/validation-rules`),
  createValidationRule: (body: ValidationRuleInput) => request<ValidationRule>(`${referenceRoot()}/validation-rules`, json("POST", body)),
  updateValidationRule: (id: string, body: ValidationRuleInput) => request<ValidationRule>(`${referenceRoot()}/validation-rules/${id}`, json("PUT", body)),
  deleteValidationRule: (id: string) => request<void>(`${referenceRoot()}/validation-rules/${id}`, json("DELETE")),
  createReference: <K extends ReferenceResource>(resource: K, body: ReferenceCreateMap[K]) => request<ReferenceReadMap[K]>(`${referenceRoot()}/${resource}`, json("POST", body)),
  updateReference: <K extends ReferenceResource>(resource: K, id: string, body: ReferenceUpdateMap[K]) => request<ReferenceReadMap[K]>(`${referenceRoot()}/${resource}/${id}`, json("PUT", body)),
  deleteReference: (resource: ReferenceResource, id: string) => request<void>(`${referenceRoot()}/${resource}/${id}`, json("DELETE")),
  layerMasters: () => request<LayerMaster[]>(layerMasterRoot()),
  createLayerMaster: (body: LayerMasterCreate) => request<LayerMaster>(layerMasterRoot(), json("POST", body)),
  updateLayerMaster: (id: string, body: LayerMasterUpdate) => request<LayerMaster>(`${layerMasterRoot()}/${id}`, json("PUT", body)),
  deleteLayerMaster: (id: string) => request<void>(`${layerMasterRoot()}/${id}`, json("DELETE")),
  previewLayerMasterImport: (body: LayerMasterImportRequest) => request<LayerMasterImportPreview>(`${layerMasterRoot()}/import/preview`, json("POST", body)),
  commitLayerMasterImport: (body: LayerMasterImportRequest) => request<LayerMasterImportCommitResult>(`${layerMasterRoot()}/import/commit`, json("POST", body)),
};

export function reviewAttachmentUrl(projectId: string, attachmentId: string) {
  return `${API_BASE}/projects/${projectId}/review-threads/attachments/${attachmentId}`;
}

export const referenceApi = {
  listBoxPresets: api.boxPresets,
  listRelationStyles: api.relationStyles,
  listKeyLayoutTypes: api.keyLayoutTypes,
  listKeyDrawingTypes: api.keyDrawingTypes,
  listKeyShapes: api.keyShapes,
  listLayerMasters: api.layerMasters,
};
