import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { api } from "../api/client";
import type { Project, ProjectCreate } from "../types";
import { useAppStore } from "./app";

export const useProjectStore = defineStore("project", () => {
  const app = useAppStore();
  const projects = ref<Project[]>([]);
  const projectId = ref("");
  const currentProject = computed(() => projects.value.find((item) => item.id === projectId.value) ?? null);

  async function loadProjects() { projects.value = await app.run("프로젝트 불러오기", api.listProjects) }
  async function createProject(body: ProjectCreate) {
    const project = await app.run("프로젝트 생성", () => api.createProject(body));
    await loadProjects();
    projectId.value = project.id;
    return project;
  }
  async function deleteProject(id: string) {
    await app.run("프로젝트 삭제", () => api.deleteProject(id));
    if (projectId.value === id) projectId.value = "";
    await loadProjects();
  }

  return { projects, projectId, currentProject, loadProjects, createProject, deleteProject };
});
