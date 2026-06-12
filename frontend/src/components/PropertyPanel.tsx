import { useEffect, useState } from "react";
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
  onUpdateStyles: (layerIds: string[], payload: Partial<ShapeStyle>) => Promise<void>;
}

const RELATION_TYPES = ["parent_child", "reference", "optional", "blocking"];
const COLOR_SWATCHES = ["#ffffff", "#fef3c7", "#dbeafe", "#dcfce7", "#ffe4e6", "#e5e7eb", "#111827", "#2563eb", "#dc2626"];

function ColorSwatches({ onPick }: { onPick: (color: string) => void }) {
  return (
    <div className="color-swatches">
      {COLOR_SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          className="color-swatch"
          style={{ backgroundColor: color }}
          title={color}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

function DraftColorInput({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      type="color"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

function DraftNumberInput({
  value,
  min,
  max,
  onCommit
}: {
  value: number;
  min: number;
  max?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value)));

  useEffect(() => {
    setDraft(String(Math.round(value)));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next !== value) {
      onCommit(next);
    }
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

export default function PropertyPanel({
  graph,
  selection,
  onSelectionChange,
  onUpdateLayer,
  onUpdateStyle,
  onUpdateLayout,
  onUpdateRelation,
  onUpdateTextBox,
  onUpdateStyles
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
    void onUpdateStyles(selectedLayerIds, payload);
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
          <ColorSwatches onPick={(color) => updateManyStyles({ fill_color: color })} />
          <label>
            Line
            <input type="color" onChange={(event) => updateManyStyles({ stroke_color: event.target.value })} />
          </label>
          <ColorSwatches onPick={(color) => updateManyStyles({ stroke_color: color })} />
          <label>
            Text
            <input type="color" onChange={(event) => updateManyStyles({ text_color: event.target.value })} />
          </label>
          <ColorSwatches onPick={(color) => updateManyStyles({ text_color: color })} />
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
              <DraftColorInput value={singleStyle.fill_color} onCommit={(color) => void onUpdateStyle(singleLayer.id, { fill_color: color })} />
            </label>
            <ColorSwatches onPick={(color) => void onUpdateStyle(singleLayer.id, { fill_color: color })} />
            <label>
              Line
              <DraftColorInput value={singleStyle.stroke_color} onCommit={(color) => void onUpdateStyle(singleLayer.id, { stroke_color: color })} />
            </label>
            <ColorSwatches onPick={(color) => void onUpdateStyle(singleLayer.id, { stroke_color: color })} />
            <label>
              Text
              <DraftColorInput value={singleStyle.text_color} onCommit={(color) => void onUpdateStyle(singleLayer.id, { text_color: color })} />
            </label>
            <ColorSwatches onPick={(color) => void onUpdateStyle(singleLayer.id, { text_color: color })} />
            <label>
              Font size
              <DraftNumberInput value={singleStyle.font_size} min={8} max={72} onCommit={(value) => void onUpdateStyle(singleLayer.id, { font_size: value })} />
            </label>
            <label>
              Width
              <DraftNumberInput value={singleLayout.width} min={60} onCommit={(value) => void onUpdateLayout(singleLayer.id, { width: value })} />
            </label>
            <label>
              Height
              <DraftNumberInput value={singleLayout.height} min={36} onCommit={(value) => void onUpdateLayout(singleLayer.id, { height: value })} />
            </label>
          </section>
        </>
      )}

      {selectedRelation && (
        <section className="property-section">
          <h2>Relation</h2>
          <label>
            Arrow style
            <select
              value={selectedRelation.relation_style_id ?? graph.relation_styles[0]?.id ?? ""}
              onChange={(event) => {
                const nextStyle = graph.relation_styles.find((style) => style.id === event.target.value);
                void onUpdateRelation(selectedRelation.id, {
                  relation_style_id: event.target.value,
                  relation_type: nextStyle?.name ?? selectedRelation.relation_type
                });
              }}
            >
              {graph.relation_styles.map((style) => (
                <option key={style.id} value={style.id}>{style.name}</option>
              ))}
            </select>
          </label>
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
            <DraftColorInput value={selectedText.text_color} onCommit={(color) => void onUpdateTextBox(selectedText.id, { text_color: color })} />
          </label>
          <label>
            Font size
            <DraftNumberInput value={selectedText.font_size} min={8} max={96} onCommit={(value) => void onUpdateTextBox(selectedText.id, { font_size: value })} />
          </label>
          <label>
            Fill
            <DraftColorInput value={selectedText.background_color} onCommit={(color) => void onUpdateTextBox(selectedText.id, { background_color: color })} />
          </label>
          <label>
            Border
            <DraftColorInput value={selectedText.border_color} onCommit={(color) => void onUpdateTextBox(selectedText.id, { border_color: color })} />
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
