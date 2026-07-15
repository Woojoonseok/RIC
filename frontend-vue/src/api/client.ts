import type { BoxPreset, Graph, GraphBatchUpdate, KeyDrawingType, KeyLayoutType, KeyShape, Layer, LayerMaster, Project, Relation, RelationStyle, ShapeStyle, Layout, TextBox, ValidationReport } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? `http://${location.hostname}:8000/api`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? `${response.status} ${response.statusText}`));
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  listProjects: () => request<Project[]>("/projects"),
  createProject: (body: { name: string; description?: string | null }) => request<Project>("/projects", json("POST", body)),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, json("DELETE")),
  getGraph: (projectId: string) => request<Graph>(`/projects/${projectId}/graph`),
  restoreGraph: (projectId: string, graph: Graph) => request<Graph>(`/projects/${projectId}/graph/restore`, json("PATCH", graph)),
  batchGraph: (projectId: string, body: GraphBatchUpdate) => request<Graph>(`/projects/${projectId}/graph/batch`, json("PATCH", body)),
  validate: (projectId: string) => request<ValidationReport>(`/projects/${projectId}/validate`, json("POST")),
  autoLayout: (projectId: string) => request<Graph>(`/projects/${projectId}/graph/auto-layout`, json("POST")),
  createLayer: (projectId: string, body: Record<string, unknown>) => request<Layer>(`/projects/${projectId}/graph/layers`, json("POST", body)),
  updateLayer: (projectId: string, id: string, body: Record<string, unknown>) => request<Layer>(`/projects/${projectId}/graph/layers/${id}`, json("PUT", body)),
  deleteLayer: (projectId: string, id: string) => request<void>(`/projects/${projectId}/graph/layers/${id}`, json("DELETE")),
  deletePreview: (projectId: string, id: string) => request<{ incoming: Relation[]; outgoing: Relation[] }>(`/projects/${projectId}/graph/layers/${id}/delete-preview`),
  updateLayout: (projectId: string, id: string, body: Record<string, unknown>) => request<Layout>(`/projects/${projectId}/graph/layers/${id}/layout`, json("PATCH", body)),
  updateStyle: (projectId: string, id: string, body: Record<string, unknown>) => request<ShapeStyle>(`/projects/${projectId}/graph/layers/${id}/style`, json("PATCH", body)),
  updateGroup: (projectId: string, id: string, group: string | null) => request<Graph>(`/projects/${projectId}/graph/layers/${id}/group`, json("PATCH", { group })),
  merge: (projectId: string, ids: string[]) => request<Graph>(`/projects/${projectId}/graph/layers/merge`, json("POST", { layer_ids: ids })),
  split: (projectId: string, id: string) => request<Graph>(`/projects/${projectId}/graph/layers/${id}/split`, json("POST", {})),
  createRelation: (projectId: string, body: Record<string, unknown>) => request<Relation>(`/projects/${projectId}/graph/relations`, json("POST", body)),
  updateRelation: (projectId: string, id: string, body: Record<string, unknown>) => request<Relation>(`/projects/${projectId}/graph/relations/${id}`, json("PUT", body)),
  deleteRelation: (projectId: string, id: string) => request<void>(`/projects/${projectId}/graph/relations/${id}`, json("DELETE")),
  createText: (projectId: string, body: Record<string, unknown>) => request<TextBox>(`/projects/${projectId}/graph/text-boxes`, json("POST", body)),
  updateText: (projectId: string, id: string, body: Record<string, unknown>) => request<TextBox>(`/projects/${projectId}/graph/text-boxes/${id}`, json("PUT", body)),
  deleteText: (projectId: string, id: string) => request<void>(`/projects/${projectId}/graph/text-boxes/${id}`, json("DELETE")),
  keyLayoutTypes: () => request<KeyLayoutType[]>("/reference/key-layout-types"),
  keyDrawingTypes: () => request<KeyDrawingType[]>("/reference/key-drawing-types"),
  keyShapes: () => request<KeyShape[]>("/reference/key-shapes"),
  relationStyles: () => request<RelationStyle[]>("/reference/relation-styles"),
  boxPresets: () => request<BoxPreset[]>("/reference/box-presets"),
  createReference: <T>(resource: string, body: Record<string, unknown>) => request<T>(`/reference/${resource}`, json("POST", body)),
  updateReference: <T>(resource: string, id: string, body: Record<string, unknown>) => request<T>(`/reference/${resource}/${id}`, json("PUT", body)),
  deleteReference: (resource: string, id: string) => request<void>(`/reference/${resource}/${id}`, json("DELETE")),
  layerMasters: () => request<LayerMaster[]>("/layer-master"),
  createLayerMaster: (body: Omit<LayerMaster, "id">) => request<LayerMaster>("/layer-master", json("POST", body)),
  updateLayerMaster: (id: string, body: Partial<LayerMaster>) => request<LayerMaster>(`/layer-master/${id}`, json("PUT", body)),
  deleteLayerMaster: (id: string) => request<void>(`/layer-master/${id}`, json("DELETE")),
};
