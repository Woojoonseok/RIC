<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const project = useProjectStore();
const branchOpen = ref(false);
const branchName = ref("");
const branchDescription = ref("");
const editor = computed(() => project.alignTrees[0] ?? null);

function openBranchForm() {
  branchName.value = `${project.currentProject?.name ?? "Project"} - Branch`;
  branchDescription.value = project.currentProject?.description ?? "";
  branchOpen.value = true;
}

async function createBranch() {
  if (!branchName.value.trim()) return;
  try {
    const created = await project.branchProject({
      name: branchName.value.trim(),
      description: branchDescription.value.trim() || null,
    });
    branchOpen.value = false;
    await router.push({ name: "project-home", params: { projectId: created.id } });
  } catch (error) {
    app.status = error instanceof Error ? error.message : String(error);
  }
}

onMounted(() => project.loadAlignTrees());
</script>

<template>
  <section class="page align-tree-list-page project-tree-page">
    <div class="page-title align-tree-title">
      <div>
        <p class="eyebrow">PROJECT EDITOR</p>
        <h1>Editor</h1>
        <p>프로젝트마다 Editor는 하나만 사용합니다.</p>
      </div>
      <button class="primary" @click="openBranchForm">현재 설정으로 새 프로젝트</button>
    </div>

    <section v-if="branchOpen" class="panel tree-create-panel">
      <div>
        <h2>프로젝트 브랜치 만들기</h2>
        <p>현재 기준정보와 Layer 정보만 복사합니다. Editor의 Layer 배치와 연결 관계는 복사하지 않습니다.</p>
      </div>
      <label>새 프로젝트 이름<input v-model="branchName" autofocus @keydown.enter="createBranch"></label>
      <label>소개<input v-model="branchDescription"></label>
      <div class="button-strip">
        <button @click="branchOpen = false">취소</button>
        <button class="primary" :disabled="!branchName.trim()" @click="createBranch">프로젝트 만들기</button>
      </div>
    </section>

    <article v-if="editor" class="panel tree-card singleton-editor-card">
      <div class="tree-card-top">
        <span class="tree-symbol">ED</span>
        <span class="access-badge owner">프로젝트 전용</span>
      </div>
      <div>
        <h2>{{ editor.name }}</h2>
        <p>{{ editor.description || "프로젝트 Editor" }}</p>
      </div>
      <dl>
        <div><dt>최근 수정</dt><dd>{{ new Date(editor.updated_at).toLocaleString() }}</dd></div>
        <div><dt>Revision</dt><dd>{{ editor.revision ?? project.currentRevision ?? 0 }}</dd></div>
      </dl>
      <RouterLink
        class="button-link primary"
        :to="{ name: 'tree-editor', params: { projectId: route.params.projectId, treeId: editor.id } }"
      >
        {{ project.currentRole === "viewer" ? "Editor 보기" : "Editor 열기" }}
      </RouterLink>
    </article>

    <section v-else class="panel tree-empty">
      <h2>Editor를 불러오지 못했습니다.</h2>
      <button @click="project.loadAlignTrees">다시 불러오기</button>
    </section>
  </section>
</template>
