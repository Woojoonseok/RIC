import type { Graph, Layer, Relation, RelationCreate } from "../types";

function orderedGroups(raw: Graph) {
  const groups = new Map<string, string[]>();
  for (const relation of raw.relations) {
    if (!relation.same_group) continue;
    const members = groups.get(relation.same_group) ?? [];
    for (const layerId of [relation.parent_layer_id, relation.child_layer_id]) {
      if (layerId && !members.includes(layerId)) members.push(layerId);
    }
    groups.set(relation.same_group, members);
  }
  return groups;
}

export function computeDisplayGraph(raw: Graph): Graph {
  const groups = orderedGroups(raw);

  const groupByLayerId = new Map<string, string[]>();
  const anchorById = new Map<string, string>();
  const hidden = new Set<string>();
  for (const ids of groups.values()) {
    const anchor = ids[0];
    for (const id of ids) {
      groupByLayerId.set(id, ids);
      anchorById.set(id, anchor);
      if (id !== anchor) hidden.add(id);
    }
  }

  const layerById = new Map(raw.layers.map((layer) => [layer.id, layer]));
  const layers: Layer[] = raw.layers.filter((layer) => !hidden.has(layer.id)).map((layer) => {
    const ids = groupByLayerId.get(layer.id);
    if (!ids) return layer;
    const members = ids.map((id) => layerById.get(id)).filter((row): row is Layer => Boolean(row));
    return {
      ...layer,
      name: members.map((row) => row.name).join("\n"),
      step: members.map((row) => row.step).filter(Boolean).join("\n") || null,
      layer_property: members.map((row) => row.layer_property).filter(Boolean).join("\n") || null,
      metadata_json: {
        ...layer.metadata_json,
        merged_layer_ids: ids,
        merged_layer_names: members.map((row) => row.name),
      },
    };
  });
  // A merge is a presentation grouping, not a geometry mutation. The first
  // selected layer is the group anchor and keeps its exact position and size.
  const layouts = raw.layouts.filter((layout) => !hidden.has(layout.layer_id));
  const seen = new Set<string>();
  const relations: Relation[] = [];
  for (const relation of raw.relations) {
    if (relation.same_group) continue;
    if (relation.parent_endpoint_type === "spare" || relation.child_endpoint_type === "spare") continue;
    const parent = relation.parent_layer_id
      ? (anchorById.get(relation.parent_layer_id) ?? relation.parent_layer_id)
      : null;
    const child = relation.child_layer_id
      ? (anchorById.get(relation.child_layer_id) ?? relation.child_layer_id)
      : null;
    if (parent && child && parent === child) continue;
    const key = parent && child
      ? relationKey(parent, child)
      : `${parent ?? ""}:${child ?? ""}:${relation.attached_relation_id ?? relation.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    relations.push({ ...relation, parent_layer_id: parent, child_layer_id: child });
  }
  return {
    ...raw,
    layers,
    layouts,
    styles: raw.styles.filter((style) => !hidden.has(style.layer_id)),
    relations,
  };
}

export function groupMaps(raw: Graph) {
  const anchorByLayerId: Record<string, string> = {};
  const groupToLayerIds: Record<string, string[]> = {};
  for (const relation of raw.relations.filter((row) => row.same_group)) {
    const group = relation.same_group!;
    const values = groupToLayerIds[group] ?? [];
    for (const id of [relation.parent_layer_id, relation.child_layer_id]) {
      if (id && !values.includes(id)) values.push(id);
    }
    groupToLayerIds[group] = values;
  }
  for (const ids of Object.values(groupToLayerIds)) {
    const anchor = ids[0];
    if (anchor) ids.forEach((id) => { anchorByLayerId[id] = anchor });
  }
  return { anchorByLayerId, groupToLayerIds };
}

export function isMergedLayer(raw: Graph, layerId: string): boolean {
  return raw.relations.some((relation) => Boolean(
    relation.same_group
    && (relation.parent_layer_id === layerId || relation.child_layer_id === layerId),
  ));
}

export function relationTargetLayerId(raw: Graph, relationId: string, visited = new Set<string>()): string | null {
  if (visited.has(relationId)) return null;
  const relation = raw.relations.find((row) => row.id === relationId);
  if (!relation) return null;
  if (relation.child_layer_id) return relation.child_layer_id;
  if (!relation.attached_relation_id) return null;
  return relationTargetLayerId(raw, relation.attached_relation_id, new Set(visited).add(relationId));
}

export function relationGroupById(raw: Graph, relationId: string): Relation[] {
  const selected = raw.relations.find((relation) => relation.id === relationId);
  if (!selected) return [];
  return raw.relations.filter((relation) => (
    !relation.same_group
    && relation.parent_layer_id === selected.parent_layer_id
    && relation.child_layer_id === selected.child_layer_id
  ));
}

function relationKey(parentId: string, childId: string) {
  return `${parentId}\u0000${childId}`;
}

export function expandRelationCandidates(raw: Graph, input: RelationCreate): RelationCreate[] {
  const parentId = input.parent_layer_id;
  const childId = input.child_layer_id;
  if (!parentId || !childId) return [input];

  const { groupToLayerIds } = groupMaps(raw);
  const members = (layerId: string) => Object.values(groupToLayerIds).find((ids) => ids.includes(layerId)) ?? [layerId];
  const parents = members(parentId);
  const children = members(childId);
  if (parents.length > 1 && children.length > 1) throw new Error("그룹 간 관계는 생성할 수 없습니다.");

  const result: RelationCreate[] = [];
  for (const parent of parents) {
    for (const child of children) {
      if (parent === child) continue;
      result.push({ ...input, parent_layer_id: parent, child_layer_id: child });
    }
  }
  return result;
}

export function graphRestoreFromGraph(graph: Graph) {
  return {
    layers: graph.layers,
    layouts: graph.layouts,
    styles: graph.styles,
    box_presets: graph.box_presets,
    relation_styles: graph.relation_styles,
    relations: graph.relations,
    text_boxes: graph.text_boxes,
  };
}
