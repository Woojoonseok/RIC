import type { Graph } from "../types";

interface Props {
  graph: Graph | null;
  onDownloadTemplate: () => void;
  onExportExcel: () => void;
  onExportSvg: () => void;
  onExportPpt: () => void;
}

export default function ExportView({ graph, onDownloadTemplate, onExportExcel, onExportSvg, onExportPpt }: Props) {
  return (
    <section className="export-view">
      <section className="panel-block export-panel">
        <div className="panel-title">Export</div>
        <div className="export-summary">
          <strong>{graph?.project.name ?? "No project"}</strong>
          <span>{graph ? `${graph.layers.length} layers / ${graph.relations.length} relations` : "Select or create a project first."}</span>
        </div>
        <div className="row">
          <button type="button" onClick={onDownloadTemplate}>Excel Template</button>
          <button type="button" onClick={onExportExcel} disabled={!graph}>Excel Export</button>
          <button type="button" onClick={onExportSvg} disabled={!graph}>PPT Image Export</button>
          <button type="button" onClick={onExportPpt} disabled={!graph}>PPT Outline Export</button>
        </div>
      </section>
    </section>
  );
}
