import { useEffect, useMemo, useRef, useState } from "react";
import type { BoxPreset, Graph, Layer, Relation, RelationStyle, SelectionItem } from "../types";

interface ParsedRow {
  [key: string]: string;
}

interface Props {
  graph: Graph | null;
  selection: SelectionItem[];
  onSelectLayer: (layerId: string, additive: boolean) => void;
  onSelectRelation: (relationId: string) => void;
  onAddLayer: () => void;
  onAddRelation: () => void;
  onUpdateLayer: (layerId: string, payload: Partial<Layer>) => void;
  onUpdateRelation: (relationId: string, payload: Partial<Relation>) => void;
  onCreateRelationStyle: () => void;
  onUpdateRelationStyle: (styleId: string, payload: Partial<RelationStyle>) => void;
  onDeleteRelationStyle: (styleId: string) => void;
  onCreateBoxPreset: () => void;
  onUpdateBoxPreset: (presetId: string, payload: Partial<BoxPreset>) => void;
  onDeleteBoxPreset: (presetId: string) => void;
  onImportLayers: (rows: ParsedRow[]) => void;
  onImportRelations: (rows: ParsedRow[]) => void;
  onValidate: () => void;
  onBuildTree: () => void;
}

const ALIGN_HEADERS = ["Step", "Layer", "Layer_Property", "Align", "Align_side"];
const RELATION_HEADERS = ["Parent_Layer", "Child_Layer", "Relation_Type"];
const BOX_SWATCHES = ["#2563eb", "#d97706", "#dc2626", "#16a34a", "#7c3aed", "#0891b2", "#6b7280", "#111827"];

function softFill(color: string) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (!match) return color;
  const [r, g, b] = match.slice(1).map((value) => parseInt(value, 16));
  const mix = (channel: number) => Math.round(channel + (255 - channel) * 0.82);
  return `#${[mix(r), mix(g), mix(b)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function parseDelimited(text: string, headers: string[]): ParsedRow[] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const cells = line.split(line.includes("\t") ? "\t" : ",").map((cell) => cell.trim());
      const hasHeader = headers.every((header, index) => cells[index]?.toLowerCase() === header.toLowerCase());
      return hasHeader ? null : Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    })
    .filter((row): row is ParsedRow => Boolean(row));
}

async function readFile(file: File, headers: string[]) {
  const text = await file.text();
  const tableText = text.includes("<table")
    ? text.replace(/<tr[^>]*>/gi, "\n").replace(/<t[dh][^>]*>/gi, "\t").replace(/<[^>]+>/g, "")
    : text;
  return parseDelimited(tableText, headers);
}

function RelationStyleRow({
  style,
  onUpdate,
  onDelete
}: {
  style: RelationStyle;
  onUpdate: (styleId: string, payload: Partial<RelationStyle>) => void;
  onDelete: (styleId: string) => void;
}) {
  const [strokeColor, setStrokeColor] = useState(style.stroke_color);

  useEffect(() => {
    setStrokeColor(style.stroke_color);
  }, [style.stroke_color]);

  const commitStrokeColor = () => {
    if (strokeColor !== style.stroke_color) {
      onUpdate(style.id, { stroke_color: strokeColor });
    }
  };

  return (
    <div className="table-row arrow-style-row">
      <input defaultValue={style.name} onBlur={(event) => onUpdate(style.id, { name: event.target.value })} />
      <input type="color" value={strokeColor} onChange={(event) => setStrokeColor(event.target.value)} onBlur={commitStrokeColor} />
      <select value={style.line_pattern} onChange={(event) => onUpdate(style.id, { line_pattern: event.target.value as RelationStyle["line_pattern"] })}>
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
        <option value="reference">Reference</option>
      </select>
      <input
        type="number"
        min="1"
        max="12"
        defaultValue={style.stroke_width}
        onBlur={(event) => onUpdate(style.id, { stroke_width: Number(event.target.value) })}
      />
      <select value={style.marker_type} onChange={(event) => onUpdate(style.id, { marker_type: event.target.value as RelationStyle["marker_type"] })}>
        <option value="arrow">Arrow</option>
        <option value="none">None</option>
      </select>
      <svg viewBox="0 0 90 18" aria-label={`${style.name} preview`}>
        <defs>
          <marker id={`import-arrow-${style.id}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 7 3.5 L 0 7 z" fill={strokeColor} />
          </marker>
        </defs>
        <line
          x1="4"
          y1="9"
          x2="78"
          y2="9"
          stroke={strokeColor}
          strokeWidth={style.stroke_width}
          strokeDasharray={
            style.line_pattern === "dashed" ? "8 6" : style.line_pattern === "dotted" ? "2 6" : style.line_pattern === "reference" ? "10 4 2 4" : undefined
          }
          markerEnd={style.marker_type === "arrow" ? `url(#import-arrow-${style.id})` : undefined}
        />
      </svg>
      <button type="button" className="table-action" onClick={() => onDelete(style.id)}>Delete</button>
    </div>
  );
}

function BoxPresetRow({
  preset,
  onUpdate,
  onDelete
}: {
  preset: BoxPreset;
  onUpdate: (presetId: string, payload: Partial<BoxPreset>) => void;
  onDelete: (presetId: string) => void;
}) {
  const [color, setColor] = useState(preset.stroke_color);

  useEffect(() => {
    setColor(preset.stroke_color);
  }, [preset.stroke_color]);

  const commitColor = (nextColor = color) => {
    onUpdate(preset.id, { stroke_color: nextColor, fill_color: softFill(nextColor) });
  };

  return (
    <div className="box-preset-row">
      <input defaultValue={preset.name} onBlur={(event) => onUpdate(preset.id, { name: event.target.value })} />
      <div
        className="box-preset-preview"
        style={{
          backgroundColor: preset.fill_color,
          borderColor: preset.stroke_color,
          color: preset.text_color,
          fontSize: Math.min(18, preset.font_size)
        }}
      >
        {preset.name}
      </div>
      <div className="box-preset-colors">
        <input
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
          onBlur={() => commitColor()}
          aria-label={`${preset.name} color`}
        />
        <div className="box-swatch-strip">
          {BOX_SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className="box-swatch"
              style={{ backgroundColor: swatch }}
              title={swatch}
              onClick={() => {
                setColor(swatch);
                commitColor(swatch);
              }}
            />
          ))}
        </div>
      </div>
      <input
        type="number"
        min="8"
        max="72"
        defaultValue={preset.font_size}
        aria-label={`${preset.name} font size`}
        onBlur={(event) => onUpdate(preset.id, { font_size: Number(event.target.value) })}
      />
      <input
        type="number"
        min="60"
        defaultValue={Math.round(preset.width)}
        aria-label={`${preset.name} width`}
        onBlur={(event) => onUpdate(preset.id, { width: Number(event.target.value) })}
      />
      <input
        type="number"
        min="36"
        defaultValue={Math.round(preset.height)}
        aria-label={`${preset.name} height`}
        onBlur={(event) => onUpdate(preset.id, { height: Number(event.target.value) })}
      />
      <button type="button" className={preset.is_default ? "active" : ""} onClick={() => onUpdate(preset.id, { is_default: true })}>
        Default
      </button>
      <button type="button" onClick={() => onDelete(preset.id)}>Delete</button>
    </div>
  );
}

export default function ImportView({
  graph,
  selection,
  onSelectLayer,
  onSelectRelation,
  onAddLayer,
  onAddRelation,
  onUpdateLayer,
  onUpdateRelation,
  onCreateRelationStyle,
  onUpdateRelationStyle,
  onDeleteRelationStyle,
  onCreateBoxPreset,
  onUpdateBoxPreset,
  onDeleteBoxPreset,
  onImportLayers,
  onImportRelations,
  onValidate,
  onBuildTree
}: Props) {
  const [pasteTarget, setPasteTarget] = useState<"align" | "relation" | null>(null);
  const [pasteText, setPasteText] = useState("");
  const alignUploadRef = useRef<HTMLInputElement | null>(null);
  const relationUploadRef = useRef<HTMLInputElement | null>(null);
  const selectedLayerIds = new Set(selection.filter((item) => item.kind === "layer").map((item) => item.id));
  const layerById = useMemo(() => new Map(graph?.layers.map((layer) => [layer.id, layer]) ?? []), [graph]);
  const relationStyleById = useMemo(
    () => new Map(graph?.relation_styles.map((style) => [style.id, style]) ?? []),
    [graph]
  );

  return (
    <section className="import-view">
      <section className="panel-block table-panel">
        <div className="panel-head">
          <div className="panel-title">Align Input</div>
          <div className="button-strip">
            <button type="button" onClick={onAddLayer}>Add Row</button>
            <button type="button" onClick={() => alignUploadRef.current?.click()}>Excel Upload</button>
            <button type="button" onClick={() => setPasteTarget("align")}>Clipboard Paste</button>
          </div>
        </div>
        <input
          ref={alignUploadRef}
          hidden
          type="file"
          accept=".csv,.tsv,.txt,.xls,.html"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file, ALIGN_HEADERS).then(onImportLayers);
            event.currentTarget.value = "";
          }}
        />
        <div className="data-table">
          <div className="table-row header">
            {ALIGN_HEADERS.map((header) => <span key={header}>{header}</span>)}
          </div>
          {graph?.layers.map((layer) => (
            <div
              key={layer.id}
              className={selectedLayerIds.has(layer.id) ? "table-row selected" : "table-row"}
              onClick={(event) => onSelectLayer(layer.id, event.ctrlKey || event.metaKey || event.shiftKey)}
            >
              <input defaultValue={layer.step ?? ""} onBlur={(event) => onUpdateLayer(layer.id, { step: event.target.value || null })} />
              <input defaultValue={layer.name} onBlur={(event) => onUpdateLayer(layer.id, { name: event.target.value })} />
              <input defaultValue={layer.layer_property ?? ""} onBlur={(event) => onUpdateLayer(layer.id, { layer_property: event.target.value || null })} />
              <input defaultValue={layer.align ?? ""} onBlur={(event) => onUpdateLayer(layer.id, { align: event.target.value || null })} />
              <input defaultValue={layer.align_side ?? ""} onBlur={(event) => onUpdateLayer(layer.id, { align_side: event.target.value || null })} />
            </div>
          ))}
          {graph && graph.layers.length === 0 && <div className="empty-state">Add or paste Layer rows.</div>}
        </div>
      </section>

      <section className="panel-block table-panel">
        <div className="panel-head">
          <div className="panel-title">Layer Relation</div>
          <div className="button-strip">
            <button type="button" onClick={onAddRelation}>Add Row</button>
            <button type="button" onClick={() => relationUploadRef.current?.click()}>Excel Upload</button>
            <button type="button" onClick={() => setPasteTarget("relation")}>Clipboard Paste</button>
          </div>
        </div>
        <input
          ref={relationUploadRef}
          hidden
          type="file"
          accept=".csv,.tsv,.txt,.xls,.html"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file, RELATION_HEADERS).then(onImportRelations);
            event.currentTarget.value = "";
          }}
        />
        <div className="data-table relation-table">
          <div className="table-row header">
            {RELATION_HEADERS.map((header) => <span key={header}>{header}</span>)}
          </div>
          {graph?.relations.map((relation) => (
            <div key={relation.id} className="table-row" onClick={() => onSelectRelation(relation.id)}>
              <select value={relation.parent_layer_id} onChange={(event) => onUpdateRelation(relation.id, { parent_layer_id: event.target.value })}>
                {graph.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
              </select>
              <select value={relation.child_layer_id} onChange={(event) => onUpdateRelation(relation.id, { child_layer_id: event.target.value })}>
                {graph.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
              </select>
              <select
                value={relation.relation_style_id ?? graph.relation_styles[0]?.id ?? ""}
                onChange={(event) => {
                  const style = relationStyleById.get(event.target.value);
                  onUpdateRelation(relation.id, {
                    relation_style_id: event.target.value,
                    relation_type: style?.name ?? relation.relation_type
                  });
                }}
              >
                {graph.relation_styles.map((style) => (
                  <option key={style.id} value={style.id}>{style.name}</option>
                ))}
              </select>
            </div>
          ))}
          {graph && graph.relations.length === 0 && <div className="empty-state">Add or paste relation rows.</div>}
        </div>
      </section>

      <section className="panel-block table-panel arrow-style-panel">
        <div className="panel-head">
          <div className="panel-title">Arrow Style</div>
          <div className="button-strip">
            <button type="button" onClick={onCreateRelationStyle}>Add Arrow</button>
          </div>
        </div>
        <div className="data-table arrow-style-table">
          <div className="table-row header">
            <span>Name</span>
            <span>Color</span>
            <span>Line Type</span>
            <span>Width</span>
            <span>Marker</span>
            <span>Preview</span>
            <span></span>
          </div>
          {graph?.relation_styles.map((style) => (
            <RelationStyleRow key={style.id} style={style} onUpdate={onUpdateRelationStyle} onDelete={onDeleteRelationStyle} />
          ))}
        </div>
      </section>

      <section className="panel-block table-panel box-presets-panel">
        <div className="panel-head">
          <div className="panel-title">Box Preset</div>
          <div className="button-strip">
            <button type="button" onClick={onCreateBoxPreset}>Add Box</button>
          </div>
        </div>
        <div className="box-preset-header">
          <span>Name</span>
          <span>Preview</span>
          <span>Color</span>
          <span>Font</span>
          <span>W</span>
          <span>H</span>
          <span></span>
          <span></span>
        </div>
        <div className="box-preset-list">
          {!graph && <div className="empty-state">Open a project to customize Layer boxes.</div>}
          {(graph?.box_presets?.length ?? 0) === 0 && graph && <div className="empty-state">Add a box preset.</div>}
          {graph?.box_presets?.map((preset) => (
            <BoxPresetRow key={preset.id} preset={preset} onUpdate={onUpdateBoxPreset} onDelete={onDeleteBoxPreset} />
          ))}
        </div>
      </section>

      {pasteTarget && (
      <section className="panel-block paste-panel">
        <div className="panel-head">
          <div className="panel-title">{pasteTarget === "align" ? "Align Input" : "Layer Relation"} Paste</div>
          <div className="button-strip">
            <button type="button" onClick={() => setPasteTarget(null)}>Close</button>
            <button
              type="button"
              onClick={() => {
                const headers = pasteTarget === "align" ? ALIGN_HEADERS : RELATION_HEADERS;
                const rows = parseDelimited(pasteText, headers);
                if (pasteTarget === "align") onImportLayers(rows);
                else onImportRelations(rows);
                setPasteText("");
                setPasteTarget(null);
              }}
            >
              Apply
            </button>
          </div>
        </div>
        <textarea
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          placeholder={pasteTarget === "align" ? ALIGN_HEADERS.join("\t") : RELATION_HEADERS.join("\t")}
        />
      </section>
      )}

      <section className="panel-block validation-panel">
        <div className="panel-head">
          <div className="panel-title">Validation Result</div>
          <div className="button-strip">
            <button type="button" onClick={onValidate}>Validate</button>
            <button type="button" onClick={onBuildTree}>Build Align Tree</button>
          </div>
        </div>
        <div className="validation-list">
          {graph?.validation.issues.length === 0 && <div className="empty-state">No validation issues.</div>}
          {graph?.validation.issues.map((issue, index) => (
            <div key={`${issue.code}-${index}`} className={issue.severity}>
              {issue.message}
              {issue.layer_id && <small>{layerById.get(issue.layer_id)?.name}</small>}
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
