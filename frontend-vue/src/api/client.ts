import type {
  BoxPreset, Graph, GraphBatchUpdate, GraphRestore, KeyDrawingType, KeyLayoutType, KeyShape, Layer, LayerCreate,
  LayerMaster, LayerMasterCreate, LayerMasterUpdate, LayerMergeRequest, LayerSplitRequest, LayerUpdate, Layout,
  LayoutUpdate, Project, ProjectCreate, ReferenceCreateMap, ReferenceReadMap, ReferenceResource, ReferenceUpdateMap,
  Relation, RelationCreate, RelationStyle, RelationUpdate, ShapeStyle, StyleUpdate, TextBox, TextBoxCreate,
  TextBoxUpdate, ValidationReport,
} from "../types";

const browserHost = typeof location === "undefined" ? "127.0.0.1" : location.hostname;
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? `http://${browserHost}:8000/api`;

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

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    const detail = describeErrorDetail(body?.detail);
    throw new Error(detail || `${response.status} ${response.statusText}`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

const json = <T>(method: string, body?: T): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  listProjects: () => request<Project[]>("/projects"),
  createProject: (body: ProjectCreate) => request<Project>("/projects", json("POST", body)),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, json("DELETE")),
  getGraph: (projectId: string) => request<Graph>(`/projects/${projectId}/graph`),
  restoreGraph: (projectId: string, body: GraphRestore) => request<Graph>(`/projects/${projectId}/graph/restore`, json("PATCH", body)),
  batchGraph: (projectId: string, body: GraphBatchUpdate) => request<Graph>(`/projects/${projectId}/graph/batch`, json("PATCH", body)),
  validate: (projectId: string) => request<ValidationReport>(`/projects/${projectId}/validate`, json("POST")),
  autoLayout: (projectId: string) => request<Graph>(`/projects/${projectId}/graph/auto-layout`, json("POST")),
  createLayer: (projectId: string, body: LayerCreate) => request<Layer>(`/projects/${projectId}/graph/layers`, json("POST", body)),
  updateLayer: (projectId: string, id: string, body: LayerUpdate) => request<Layer>(`/projects/${projectId}/graph/layers/${id}`, json("PUT", body)),
  deleteLayer: (projectId: string, id: string) => request<void>(`/projects/${projectId}/graph/layers/${id}`, json("DELETE")),
  deletePreview: (projectId: string, id: string) => request<{ incoming: Relation[]; outgoing: Relation[] }>(`/projects/${projectId}/graph/layers/${id}/delete-preview`),
  updateLayout: (projectId: string, id: string, body: LayoutUpdate) => request<Layout>(`/projects/${projectId}/graph/layers/${id}/layout`, json("PATCH", body)),
  updateStyle: (projectId: string, id: string, body: StyleUpdate) => request<ShapeStyle>(`/projects/${projectId}/graph/layers/${id}/style`, json("PATCH", body)),
  updateGroup: (projectId: string, id: string, group: string | null) => request<Graph>(`/projects/${projectId}/graph/layers/${id}/group`, json("PATCH", { group })),
  merge: (projectId: string, body: LayerMergeRequest) => request<Graph>(`/projects/${projectId}/graph/layers/merge`, json("POST", body)),
  split: (projectId: string, id: string, body: LayerSplitRequest = {}) => request<Graph>(`/projects/${projectId}/graph/layers/${id}/split`, json("POST", body)),
  createRelation: (projectId: string, body: RelationCreate) => request<Relation>(`/projects/${projectId}/graph/relations`, json("POST", body)),
  updateRelation: (projectId: string, id: string, body: RelationUpdate) => request<Relation>(`/projects/${projectId}/graph/relations/${id}`, json("PUT", body)),
  deleteRelation: (projectId: string, id: string) => request<void>(`/projects/${projectId}/graph/relations/${id}`, json("DELETE")),
  createText: (projectId: string, body: TextBoxCreate) => request<TextBox>(`/projects/${projectId}/graph/text-boxes`, json("POST", body)),
  updateText: (projectId: string, id: string, body: TextBoxUpdate) => request<TextBox>(`/projects/${projectId}/graph/text-boxes/${id}`, json("PUT", body)),
  deleteText: (projectId: string, id: string) => request<void>(`/projects/${projectId}/graph/text-boxes/${id}`, json("DELETE")),
  keyLayoutTypes: () => request<KeyLayoutType[]>("/reference/key-layout-types"),
  keyDrawingTypes: () => request<KeyDrawingType[]>("/reference/key-drawing-types"),
  keyShapes: () => request<KeyShape[]>("/reference/key-shapes"),
  relationStyles: () => request<RelationStyle[]>("/reference/relation-styles"),
  boxPresets: () => request<BoxPreset[]>("/reference/box-presets"),
  createReference: <K extends ReferenceResource>(resource: K, body: ReferenceCreateMap[K]) => request<ReferenceReadMap[K]>(`/reference/${resource}`, json("POST", body)),
  updateReference: <K extends ReferenceResource>(resource: K, id: string, body: ReferenceUpdateMap[K]) => request<ReferenceReadMap[K]>(`/reference/${resource}/${id}`, json("PUT", body)),
  deleteReference: (resource: ReferenceResource, id: string) => request<void>(`/reference/${resource}/${id}`, json("DELETE")),
  layerMasters: () => request<LayerMaster[]>("/layer-master"),
  createLayerMaster: (body: LayerMasterCreate) => request<LayerMaster>("/layer-master", json("POST", body)),
  updateLayerMaster: (id: string, body: LayerMasterUpdate) => request<LayerMaster>(`/layer-master/${id}`, json("PUT", body)),
  deleteLayerMaster: (id: string) => request<void>(`/layer-master/${id}`, json("DELETE")),
};
