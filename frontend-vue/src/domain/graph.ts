import type { Graph, Layer, Layout, Relation, RelationCreate } from "../types";

class UnionFind {
  private parent = new Map<string, string>();
  add(id: string) { if (!this.parent.has(id)) this.parent.set(id, id) }
  find(id: string): string {
    this.add(id);
    const parent = this.parent.get(id)!;
    if (parent !== id) this.parent.set(id, this.find(parent));
    return this.parent.get(id)!;
  }
  union(a: string, b: string) { this.parent.set(this.find(b), this.find(a)) }
}

export function computeDisplayGraph(raw: Graph): Graph {
  const dsu = new UnionFind();
  const groupedIds = new Set<string>();
  for (const relation of raw.relations) {
    if (relation.same_group && relation.parent_layer_id && relation.child_layer_id) {
      dsu.union(relation.parent_layer_id, relation.child_layer_id);
      groupedIds.add(relation.parent_layer_id);
      groupedIds.add(relation.child_layer_id);
    }
  }
  if (!groupedIds.size) return raw;

  const groups = new Map<string, string[]>();
  for (const layer of raw.layers) {
    if (!groupedIds.has(layer.id)) continue;
    const root = dsu.find(layer.id);
    groups.set(root, [...(groups.get(root) ?? []), layer.id]);
  }
  const anchorById = new Map<string, string>();
  const hidden = new Set<string>();
  for (const ids of groups.values()) {
    const anchor = ids[0];
    for (const id of ids) {
      anchorById.set(id, anchor);
      if (id !== anchor) hidden.add(id);
    }
  }

  const layerById = new Map(raw.layers.map((layer) => [layer.id, layer]));
  const layoutById = new Map(raw.layouts.map((layout) => [layout.layer_id, layout]));
  const layers: Layer[] = raw.layers.filter((layer) => !hidden.has(layer.id)).map((layer) => {
    const ids = groups.get(dsu.find(layer.id));
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
  const layouts: Layout[] = raw.layouts.filter((layout) => !hidden.has(layout.layer_id)).map((layout) => {
    const ids = groups.get(dsu.find(layout.layer_id));
    if (!ids) return layout;
    const rows = ids.map((id) => layoutById.get(id)).filter((row): row is Layout => Boolean(row));
    const minX = Math.min(...rows.map((row) => row.x));
    const minY = Math.min(...rows.map((row) => row.y));
    return {
      ...layout,
      x: minX,
      y: minY,
      width: Math.max(180, Math.max(...rows.map((row) => row.x + row.width)) - minX),
      height: Math.max(72, Math.max(...rows.map((row) => row.y + row.height)) - minY),
    };
  });
  const seen = new Set<string>();
  const relations: Relation[] = [];
  for (const relation of raw.relations) {
    if (relation.same_group || !relation.parent_layer_id || !relation.child_layer_id) continue;
    const parent = anchorById.get(relation.parent_layer_id) ?? relation.parent_layer_id;
    const child = anchorById.get(relation.child_layer_id) ?? relation.child_layer_id;
    if (parent === child) continue;
    const key = `${parent}:${child}:${relation.instance ?? ""}`;
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
    const anchor = raw.layers.find((layer) => ids.includes(layer.id))?.id;
    if (anchor) ids.forEach((id) => { anchorByLayerId[id] = anchor });
  }
  return { anchorByLayerId, groupToLayerIds };
}

function relationKey(parentId: string, childId: string, instance?: string | null) {
  return `${parentId}\u0000${childId}\u0000${instance ?? ""}`;
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

  const existing = new Set(raw.relations.flatMap((relation) =>
    relation.parent_layer_id && relation.child_layer_id
      ? [relationKey(relation.parent_layer_id, relation.child_layer_id, relation.instance)]
      : [],
  ));
  const requested = new Set<string>();
  const result: RelationCreate[] = [];
  for (const parent of parents) {
    for (const child of children) {
      const key = relationKey(parent, child, input.instance);
      if (parent === child || existing.has(key) || requested.has(key)) continue;
      requested.add(key);
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
