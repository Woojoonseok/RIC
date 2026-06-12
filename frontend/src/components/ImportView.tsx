import { useMemo, useRef, useState } from "react";
import type { Graph, Layer, Relation, SelectionItem } from "../types";

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
  onImportLayers: (rows: ParsedRow[]) => void;
  onImportRelations: (rows: ParsedRow[]) => void;
  onValidate: () => void;
  onBuildTree: () => void;
}

const ALIGN_HEADERS = ["Step", "Layer", "Layer_Property", "Align", "Align_side"];
const RELATION_HEADERS = ["Parent_Layer", "Child_Layer", "Relation_Type"];

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

export default function ImportView({
  graph,
  selection,
  onSelectLayer,
  onSelectRelation,
  onAddLayer,
  onAddRelation,
  onUpdateLayer,
  onUpdateRelation,
  onImportLayers,
  onImportRelations,
  onValidate,
  onBuildTree
}: Props) {
  const [pasteTarget, setPasteTarget] = useState<"align" | "relation">("align");
  const [pasteText, setPasteText] = useState("");
  const alignUploadRef = useRef<HTMLInputElement | null>(null);
  const relationUploadRef = useRef<HTMLInputElement | null>(null);
  const selectedLayerIds = new Set(selection.filter((item) => item.kind === "layer").map((item) => item.id));
  const layerById = useMemo(() => new Map(graph?.layers.map((layer) => [layer.id, layer]) ?? []), [graph]);

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
              <input defaultValue={relation.relation_type} onBlur={(event) => onUpdateRelation(relation.id, { relation_type: event.target.value || "Align" })} />
            </div>
          ))}
          {graph && graph.relations.length === 0 && <div className="empty-state">Add or paste relation rows.</div>}
        </div>
      </section>

      <section className="panel-block paste-panel">
        <div className="panel-head">
          <div className="panel-title">{pasteTarget === "align" ? "Align Input" : "Layer Relation"} Paste</div>
          <div className="button-strip">
            <button
              type="button"
              onClick={() => {
                const headers = pasteTarget === "align" ? ALIGN_HEADERS : RELATION_HEADERS;
                const rows = parseDelimited(pasteText, headers);
                if (pasteTarget === "align") onImportLayers(rows);
                else onImportRelations(rows);
                setPasteText("");
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
