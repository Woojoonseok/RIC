import type { Graph, SelectionItem } from "../types";

interface Props {
  graph: Graph | null;
  selection: SelectionItem[];
  onSelect: (layerId: string, additive: boolean) => void;
}

export default function LayerList({ graph, selection, onSelect }: Props) {
  const selectedIds = new Set(selection.filter((item) => item.kind === "layer").map((item) => item.id));

  return (
    <aside className="layer-list">
      <div className="panel-title">Layers</div>
      {!graph && <div className="empty-state">Create or select a project.</div>}
      {graph?.layers.map((layer) => (
        <button
          key={layer.id}
          type="button"
          className={selectedIds.has(layer.id) ? "selected row-button" : "row-button"}
          onClick={(event) => onSelect(layer.id, event.ctrlKey || event.metaKey || event.shiftKey)}
        >
          <span>{layer.name}</span>
          <small>{layer.step || "No step"}</small>
        </button>
      ))}
      {graph && graph.layers.length === 0 && <div className="empty-state">No layers yet.</div>}
      {graph && graph.validation.issues.length > 0 && (
        <div className="validation-list">
          {graph.validation.issues.map((issue, index) => (
            <div key={`${issue.code}-${index}`} className={issue.severity}>
              {issue.message}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
