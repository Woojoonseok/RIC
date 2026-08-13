<script setup lang="ts">
import { Table2, Waypoints } from "@lucide/vue";
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
const workflowLabels = { draft: "초안", in_review: "검토 중", approved: "승인 완료", published: "공식 배포" } as const;
const editorCards = computed(() => {
  const current = editor.value;
  if (!current) return [];
  const projectId = String(route.params.projectId || "");
  const action = (name: string) => project.currentRole === "viewer" ? `${name} 보기` : `${name} 열기`;
  return [
    {
      id: "overlay",
      icon: Waypoints,
      title: "Overlay Key Editor",
      description: "Layer 배치와 Relation을 캔버스에서 편집합니다.",
      detailLabel: "최근 수정",
      detailValue: new Date(current.updated_at).toLocaleString(),
      revision: current.revision ?? project.currentRevision ?? 0,
      to: { name: "tree-editor", params: { projectId, treeId: current.id } },
      action: action("Overlay Key"),
      workflowStatus: current.workflow_status ?? "draft",
    },
    {
      id: "align",
      icon: Table2,
      title: "Align Key Editor",
      description: "독립된 Align Key Table에서 표 데이터를 편집합니다.",
      detailLabel: "작업 화면",
      detailValue: "Align Key Table",
      revision: current.revision ?? project.currentRevision ?? 0,
      to: { name: "align-key-editor", params: { projectId } },
      action: action("Align Key"),
      workflowStatus: null,
    },
  ] as const;
});

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
        <p class="eyebrow">PROJECT KEY WORKSPACE</p>
        <h1>Key Editors</h1>
        <p>기준정보와 Layer 정보를 공유하는 두 개의 Key Editor입니다.</p>
      </div>
      <button @click="openBranchForm">프로젝트 복제</button>
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

    <div v-if="editorCards.length" class="tree-card-grid editor-choice-grid">
      <article v-for="card in editorCards" :key="card.id" class="panel tree-card editor-choice-card" :class="card.id">
        <div class="tree-card-top">
          <span class="tree-symbol"><component :is="card.icon" :size="22" :stroke-width="1.8"/></span>
          <span v-if="card.workflowStatus" class="workflow-list-badge" :class="`is-${card.workflowStatus}`">{{ workflowLabels[card.workflowStatus] }}</span>
          <span v-else class="access-badge owner">공통 기준정보</span>
        </div>
        <div>
          <h2>{{ card.title }}</h2>
          <p>{{ card.description }}</p>
        </div>
        <dl>
          <div><dt>{{ card.detailLabel }}</dt><dd>{{ card.detailValue }}</dd></div>
          <div><dt>버전</dt><dd>{{ card.revision }}</dd></div>
        </dl>
        <RouterLink
          class="button-link primary"
          :to="card.to"
        >
          {{ card.action }} <span aria-hidden="true">→</span>
        </RouterLink>
      </article>
    </div>

    <section v-else class="panel tree-empty">
      <h2>Editor를 불러오지 못했습니다.</h2>
      <button @click="project.loadAlignTrees">다시 불러오기</button>
    </section>
  </section>
</template>
