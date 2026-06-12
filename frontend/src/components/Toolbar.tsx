import type { EditorMode, Project, RelationStyle } from "../types";

interface Props {
  mode: EditorMode;
  busy: boolean;
  status: string;
  projectId: string;
  projects: Project[];
  relationStyles: RelationStyle[];
  selectedRelationStyleId: string;
  selectedProject: Project | null;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  onRelationStyleChange: (styleId: string) => void;
  onCreateRelationStyle: () => void;
  onModeChange: (mode: EditorMode) => void;
  onCreateLayer: () => void;
  onCreateTextBox: () => void;
  onAutoLayout: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}

export default function Toolbar({
  mode,
  busy,
  status,
  projectId,
  projects,
  relationStyles,
  selectedRelationStyleId,
  selectedProject,
  onProjectChange,
  onCreateProject,
  onRelationStyleChange,
  onCreateRelationStyle,
  onModeChange,
  onCreateLayer,
  onCreateTextBox,
  onAutoLayout,
  onDelete,
  onRefresh
}: Props) {
  return (
    <header className="toolbar">
      <div className="brand">
        <strong>RIC</strong>
        <span>{selectedProject?.name ?? "No project"}</span>
      </div>
      <select value={projectId} onChange={(event) => onProjectChange(event.target.value)} aria-label="Project">
        <option value="">Select project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={onCreateProject}>New Project</button>
      <div className="divider" />
      <select value={selectedRelationStyleId} onChange={(event) => onRelationStyleChange(event.target.value)} aria-label="Arrow style">
        {relationStyles.map((style) => (
          <option key={style.id} value={style.id}>
            {style.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={onCreateRelationStyle} disabled={!projectId}>Add Arrow</button>
      <div className="divider" />
      <button type="button" className={mode === "select" ? "active" : ""} onClick={() => onModeChange("select")}>
        Select
      </button>
      <button type="button" className={mode === "connect" ? "active" : ""} onClick={() => onModeChange("connect")}>
        Connect
      </button>
      <button type="button" className={mode === "text" ? "active" : ""} onClick={() => onModeChange("text")}>
        Text
      </button>
      <div className="divider" />
      <button type="button" onClick={onCreateLayer}>Add Layer</button>
      <button type="button" onClick={onCreateTextBox}>Add Text</button>
      <button type="button" onClick={onAutoLayout} disabled={!projectId}>Auto Layout</button>
      <button type="button" onClick={onDelete}>Delete</button>
      <button type="button" onClick={onRefresh}>Refresh</button>
      <div className="toolbar-status" data-busy={busy}>
        {busy ? "Saving..." : status}
      </div>
    </header>
  );
}
