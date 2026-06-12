import { useState } from "react";
import type { Project } from "../types";

interface Props {
  projects: Project[];
  currentProjectId: string;
  onOpenProject: (projectId: string) => void;
  onCreateProject: (name: string) => void;
  onLoadSample: () => void;
  onDownloadTemplate: () => void;
}

export default function HomeView({
  projects,
  currentProjectId,
  onOpenProject,
  onCreateProject,
  onLoadSample,
  onDownloadTemplate
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
    </section>
  );
}
