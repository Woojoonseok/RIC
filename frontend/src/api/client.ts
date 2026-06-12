import type {
  Graph,
  GraphBatchUpdate,
  LayerMergeRequest,
  LayerSplitRequest,
  BoxPreset,
  Layer,
  Layout,
  Project,
  Relation,
  RelationStyle,
  ShapeStyle,
  TextBox,
  ValidationReport
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";

type JsonValue = Record<string, unknown> | unknown[];

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      // Keep the HTTP status message.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  listProjects: () => request<Project[]>("/projects"),
  createProject: (payload: { name: string; description?: string | null }) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(payload) }),
  getGraph: (projectId: string) => request<Graph>(`/projects/${projectId}/graph`),
  batchUpdateGraph: (projectId: string, payload: GraphBatchUpdate) =>
    request<Graph>(`/projects/${projectId}/graph/batch`, { method: "PATCH", body: JSON.stringify(payload) }),
  restoreGraph: (projectId: string, payload: Graph) =>
    request<Graph>(`/projects/${projectId}/graph/restore`, { method: "PATCH", body: JSON.stringify(payload) }),
  validate: (projectId: string) => request<ValidationReport>(`/projects/${projectId}/validate`, { method: "POST" }),
  autoLayout: (projectId: string) => request<Graph>(`/projects/${projectId}/graph/auto-layout`, { method: "POST" }),
  createLayer: (projectId: string, payload: JsonValue) =>
    request<Layer>(`/projects/${projectId}/graph/layers`, { method: "POST", body: JSON.stringify(payload) }),
  updateLayer: (projectId: string, layerId: string, payload: JsonValue) =>
    request<Layer>(`/projects/${projectId}/graph/layers/${layerId}`, { method: "PUT", body: JSON.stringify(payload) }),
  mergeLayers: (projectId: string, payload: LayerMergeRequest) =>
    request<Graph>(`/projects/${projectId}/graph/layers/merge`, { method: "POST", body: JSON.stringify(payload) }),
  splitLayer: (projectId: string, layerId: string, payload: LayerSplitRequest = {}) =>
    request<Graph>(`/projects/${projectId}/graph/layers/${layerId}/split`, { method: "POST", body: JSON.stringify(payload) }),
  updateLayout: (projectId: string, layerId: string, payload: JsonValue) =>
    request<Layout>(`/projects/${projectId}/graph/layers/${layerId}/layout`, { method: "PATCH", body: JSON.stringify(payload) }),
  updateStyle: (projectId: string, layerId: string, payload: JsonValue) =>
    request<ShapeStyle>(`/projects/${projectId}/graph/layers/${layerId}/style`, { method: "PATCH", body: JSON.stringify(payload) }),
  createBoxPreset: (projectId: string, payload: JsonValue) =>
    request<BoxPreset>(`/projects/${projectId}/graph/box-presets`, { method: "POST", body: JSON.stringify(payload) }),
  updateBoxPreset: (projectId: string, presetId: string, payload: JsonValue) =>
    request<BoxPreset>(`/projects/${projectId}/graph/box-presets/${presetId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteBoxPreset: (projectId: string, presetId: string) =>
    request<void>(`/projects/${projectId}/graph/box-presets/${presetId}`, { method: "DELETE" }),
  previewDeleteLayer: (projectId: string, layerId: string) =>
    request<{ incoming: Relation[]; outgoing: Relation[] }>(`/projects/${projectId}/graph/layers/${layerId}/delete-preview`),
  deleteLayer: (projectId: string, layerId: string) =>
    request<void>(`/projects/${projectId}/graph/layers/${layerId}`, { method: "DELETE" }),
  createRelation: (projectId: string, payload: JsonValue) =>
    request<Relation>(`/projects/${projectId}/graph/relations`, { method: "POST", body: JSON.stringify(payload) }),
  updateRelation: (projectId: string, relationId: string, payload: JsonValue) =>
    request<Relation>(`/projects/${projectId}/graph/relations/${relationId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteRelation: (projectId: string, relationId: string) =>
    request<void>(`/projects/${projectId}/graph/relations/${relationId}`, { method: "DELETE" }),
  createRelationStyle: (projectId: string, payload: JsonValue) =>
    request<RelationStyle>(`/projects/${projectId}/graph/relation-styles`, { method: "POST", body: JSON.stringify(payload) }),
  updateRelationStyle: (projectId: string, styleId: string, payload: JsonValue) =>
    request<RelationStyle>(`/projects/${projectId}/graph/relation-styles/${styleId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteRelationStyle: (projectId: string, styleId: string) =>
    request<void>(`/projects/${projectId}/graph/relation-styles/${styleId}`, { method: "DELETE" }),
  createTextBox: (projectId: string, payload: JsonValue) =>
    request<TextBox>(`/projects/${projectId}/graph/text-boxes`, { method: "POST", body: JSON.stringify(payload) }),
  updateTextBox: (projectId: string, textBoxId: string, payload: JsonValue) =>
    request<TextBox>(`/projects/${projectId}/graph/text-boxes/${textBoxId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteTextBox: (projectId: string, textBoxId: string) =>
    request<void>(`/projects/${projectId}/graph/text-boxes/${textBoxId}`, { method: "DELETE" })
};
