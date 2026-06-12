import type { Graph, Layout, Relation, SelectionItem, ShapeStyle, TextBox } from "../types";

interface Props {
  graph: Graph | null;
  selection: SelectionItem[];
  onSelectionChange: (selection: SelectionItem[]) => void;
  onUpdateLayer: (layerId: string, payload: Record<string, unknown>) => Promise<void>;
  onUpdateStyle: (layerId: string, payload: Partial<ShapeStyle>) => Promise<void>;
  onUpdateLayout: (layerId: string, payload: Partial<Layout>) => Promise<void>;
  onUpdateRelation: (relationId: string, payload: Partial<Relation>) => Promise<void>;
  onUpdateTextBox: (textBoxId: string, payload: Partial<TextBox>) => Promise<void>;
}

const RELATION_TYPES = ["parent_child", "reference", "optional", "blocking"];

export default function PropertyPanel({
  graph,
  selection,
  onSelectionChange,
  onUpdateLayer,
  onUpdateStyle,
  onUpdateLayout,
  onUpdateRelation,
  onUpdateTextBox
}: Props) {
  const selectedLayers = selection
    .filter((item) => item.kind === "layer")
    .map((item) => graph?.layers.find((layer) => layer.id === item.id))
    .filter(Boolean);
  const selectedLayerIds = selectedLayers.map((layer) => layer!.id);
  const selectedRelation = selection.length === 1 && selection[0].kind === "relation"
    ? graph?.relations.find((relation) => relation.id === selection[0].id)
    : null;
  const selectedText = selection.length === 1 && selection[0].kind === "text"
    ? graph?.text_boxes.find((textBox) => textBox.id === selection[0].id)
    : null;
  const singleLayer = selectedLayers.length === 1 ? selectedLayers[0] ?? null : null;
  const singleLayout = singleLayer ? graph?.layouts.find((layout) => layout.layer_id === singleLayer.id) : null;
  const singleStyle = singleLayer ? graph?.styles.find((style) => style.layer_id === singleLayer.id) : null;

  const updateManyStyles = (payload: Partial<ShapeStyle>) => {
    void Promise.all(selectedLayerIds.map((layerId) => onUpdateStyle(layerId, payload)));
  };

  if (!graph) {
    return (
      <aside className="property-panel">
        <div className="panel-title">Properties</div>
        <div className="empty-state">No project loaded.</div>
      </aside>
    );
  }

  return (
    <aside className="property-panel">
      <div className="panel-title">Properties</div>
      {selection.length === 0 && <div className="empty-state">Select a layer, relation, or text box.</div>}

      {selectedLayers.length > 1 && (
        <section className="property-section">
          <h2>{selectedLayers.length} Layers</h2>
          <label>
            Fill
            <input type="color" onChange={(event) => updateManyStyles({ fill_color: event.target.value })} />
          </label>
          <label>
            Line
            <input type="color" onChange={(event) => updateManyStyles({ stroke_color: event.target.value })} />
          </label>
          <label>
            Text
            <input type="color" onChange={(event) => updateManyStyles({ text_color: event.target.value })} />
          </label>
          <label>
            Font size
            <input type="number" min="8" max="72" onBlur={(event) => updateManyStyles({ font_size: Number(event.target.value) })} />
          </label>
        </section>
      )}

      {singleLayer && singleLayout && singleStyle && (
        <>
          <section className="property-section">
            <h2>Layer</h2>
            <label>
              Name
              <input
                defaultValue={singleLayer.name}
                onBlur={(event) => void onUpdateLayer(singleLayer.id, { name: event.target.value })}
              />
            </label>
            <label>
              Step
              <input
                defaultValue={singleLayer.step ?? ""}
                onBlur={(event) => void onUpdateLayer(singleLayer.id, { step: event.target.value || null })}
              />
            </label>
            <label>
              Property
              <input
                defaultValue={singleLayer.layer_property ?? ""}
                onBlur={(event) => void onUpdateLayer(singleLayer.id, { layer_property: event.target.value || null })}
              />
            </label>
            <label>
              Align
              <input
                defaultValue={singleLayer.align ?? ""}
                onBlur={(event) => void onUpdateLayer(singleLayer.id, { align: event.target.value || null })}
              />
            </label>
            <label>
              Align side
              <input
                defaultValue={singleLayer.align_side ?? ""}
                onBlur={(event) => void onUpdateLayer(singleLayer.id, { align_side: event.target.value || null })}
              />
            </label>
          </section>
          <section className="property-section">
            <h2>Shape Format</h2>
            <label>
              Fill
              <input type="color" value={singleStyle.fill_color} onChange={(event) => void onUpdateStyle(singleLayer.id, { fill_color: event.target.value })} />
            </label>
            <label>
              Line
              <input type="color" value={singleStyle.stroke_color} onChange={(event) => void onUpdateStyle(singleLayer.id, { stroke_color: event.target.value })} />
            </label>
            <label>
              Text
              <input type="color" value={singleStyle.text_color} onChange={(event) => void onUpdateStyle(singleLayer.id, { text_color: event.target.value })} />
            </label>
            <label>
              Font size
              <input
                type="number"
                min="8"
                max="72"
                value={singleStyle.font_size}
                onChange={(event) => void onUpdateStyle(singleLayer.id, { font_size: Number(event.target.value) })}
              />
            </label>
            <label>
              Width
              <input
                type="number"
                min="60"
                value={Math.round(singleLayout.width)}
                onChange={(event) => void onUpdateLayout(singleLayer.id, { width: Number(event.target.value) })}
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min="36"
                value={Math.round(singleLayout.height)}
                onChange={(event) => void onUpdateLayout(singleLayer.id, { height: Number(event.target.value) })}
              />
            </label>
          </section>
        </>
      )}

      {selectedRelation && (
        <section className="property-section">
          <h2>Relation</h2>
          <label>
            Type
            <select
              value={selectedRelation.relation_type}
              onChange={(event) => void onUpdateRelation(selectedRelation.id, { relation_type: event.target.value })}
            >
              {RELATION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source port
            <select
              value={selectedRelation.source_port}
              onChange={(event) => void onUpdateRelation(selectedRelation.id, { source_port: event.target.value as Relation["source_port"] })}
            >
              <option value="top">top</option>
              <option value="right">right</option>
              <option value="bottom">bottom</option>
              <option value="left">left</option>
            </select>
          </label>
          <label>
            Target port
            <select
              value={selectedRelation.target_port}
              onChange={(event) => void onUpdateRelation(selectedRelation.id, { target_port: event.target.value as Relation["target_port"] })}
            >
              <option value="top">top</option>
              <option value="right">right</option>
              <option value="bottom">bottom</option>
              <option value="left">left</option>
            </select>
          </label>
        </section>
      )}

      {selectedText && (
        <section className="property-section">
          <h2>Text Box</h2>
          <label>
            Text
            <textarea defaultValue={selectedText.text} onBlur={(event) => void onUpdateTextBox(selectedText.id, { text: event.target.value })} />
          </label>
          <label>
            Text color
            <input type="color" value={selectedText.text_color} onChange={(event) => void onUpdateTextBox(selectedText.id, { text_color: event.target.value })} />
          </label>
          <label>
            Font size
            <input type="number" min="8" max="96" value={selectedText.font_size} onChange={(event) => void onUpdateTextBox(selectedText.id, { font_size: Number(event.target.value) })} />
          </label>
          <label>
            Fill
            <input type="color" value={selectedText.background_color} onChange={(event) => void onUpdateTextBox(selectedText.id, { background_color: event.target.value })} />
          </label>
          <label>
            Border
            <input type="color" value={selectedText.border_color} onChange={(event) => void onUpdateTextBox(selectedText.id, { border_color: event.target.value })} />
          </label>
        </section>
      )}

      {selection.length > 0 && (
        <button type="button" className="clear-selection" onClick={() => onSelectionChange([])}>
          Clear Selection
        </button>
      )}
    </aside>
  );
}
