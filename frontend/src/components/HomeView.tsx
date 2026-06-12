import { useEffect, useState } from "react";
import type { BoxPreset, Graph, Project } from "../types";

interface Props {
  projects: Project[];
  currentProjectId: string;
  graph: Graph | null;
  onOpenProject: (projectId: string) => void;
  onCreateProject: (name: string) => void;
  onLoadSample: () => void;
  onDownloadTemplate: () => void;
  onCreateBoxPreset: () => void;
  onUpdateBoxPreset: (presetId: string, payload: Partial<BoxPreset>) => void;
  onDeleteBoxPreset: (presetId: string) => void;
}

const BOX_SWATCHES = ["#2563eb", "#d97706", "#dc2626", "#16a34a", "#7c3aed", "#0891b2", "#6b7280", "#111827"];

function softFill(color: string) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (!match) return color;
  const [r, g, b] = match.slice(1).map((value) => parseInt(value, 16));
  const mix = (channel: number) => Math.round(channel + (255 - channel) * 0.82);
  return `#${[mix(r), mix(g), mix(b)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
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

export default function HomeView({
  projects,
  currentProjectId,
  graph,
  onOpenProject,
  onCreateProject,
  onLoadSample,
  onDownloadTemplate,
  onCreateBoxPreset,
  onUpdateBoxPreset,
  onDeleteBoxPreset
}: Props) {
  const [projectName, setProjectName] = useState("");

  return (
    <section className="home-view">
      <section className="panel-block">
        <div className="panel-title">Project</div>
        <div className="row">
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Project name"
          />
          <button
            type="button"
            onClick={() => {
              onCreateProject(projectName);
              setProjectName("");
            }}
          >
            New
          </button>
        </div>
        <div className="row">
          <button type="button" onClick={onLoadSample}>Load Sample</button>
          <button type="button" onClick={onDownloadTemplate}>Excel Template</button>
        </div>
      </section>
      <section className="panel-block">
        <div className="panel-title">Recent Projects</div>
        <div className="project-list">
          {projects.length === 0 && <div className="empty-state">No projects yet.</div>}
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={project.id === currentProjectId ? "project-card selected" : "project-card"}
              onClick={() => onOpenProject(project.id)}
            >
              <strong>{project.name}</strong>
              <small>{new Date(project.updated_at).toLocaleString()}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="panel-block box-presets-panel">
        <div className="panel-head">
          <div className="panel-title">Box Presets</div>
          <button type="button" onClick={onCreateBoxPreset} disabled={!currentProjectId}>Add Box</button>
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
    </section>
  );
}
