<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "../stores/app";
import { useProjectStore } from "../stores/project";
import type { AlignTree } from "../types";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const project = useProjectStore();
const name = ref("");
const description = ref("");
const creating = ref(false);

async function createTree() {
  if (!name.value.trim()) return;
  try {
    const created = await project.createAlignTree({ name: name.value.trim(), description: description.value.trim() || null });
    name.value = ""; description.value = ""; creating.value = false;
    await router.push({ name: "tree-editor", params: { projectId: route.params.projectId, treeId: created.id } });
  } catch (error) { app.status = error instanceof Error ? error.message : String(error) }
}

async function rename(tree: AlignTree) {
  const next = prompt("Align Tree 이름", tree.name)?.trim();
  if (!next || next === tree.name) return;
  await project.updateAlignTree(tree.id, { name: next });
}

async function remove(tree: AlignTree) {
  if (!confirm(`“${tree.name}” Align Tree를 삭제할까요?`)) return;
  await project.deleteAlignTree(tree.id);
}

onMounted(() => project.loadAlignTrees());
</script>

<template>
  <section class="page align-tree-list-page project-tree-page">
    <div class="page-title align-tree-title"><div><p class="eyebrow">PROJECT ALIGN TREES</p><h1>Align Tree List</h1><p>{{ project.currentProject?.name }} 프로젝트 안의 Align Tree를 관리합니다.</p></div><button v-if="project.canEditProject" class="primary" @click="creating = !creating">{{ creating ? '닫기' : '새 Align Tree' }}</button></div>

    <section v-if="creating" class="panel tree-create-panel"><label>Align Tree 이름<input v-model="name" autofocus placeholder="예: Main Flow" @keydown.enter="createTree"></label><label>설명<input v-model="description" placeholder="선택 사항"></label><button class="primary" :disabled="!name.trim()" @click="createTree">생성하고 열기</button></section>

    <div class="tree-list-summary"><span><b>{{ project.alignTrees.length }}</b> Align Trees</span><span><b>{{ project.currentRole }}</b> 내 프로젝트 권한</span><span><b>{{ project.autosaveLabel }}</b> 저장 방식</span><button @click="project.loadAlignTrees">새로고침</button></div>
    <div class="tree-card-grid">
      <article v-for="tree in project.alignTrees" :key="tree.id" class="panel tree-card">
        <div class="tree-card-top"><span class="tree-symbol">⌘</span><div class="align-tree-badges"><span v-if="tree.is_default" class="access-badge owner">Default</span><span v-if="project.leaseState === 'locked' || (project.currentProject?.is_locked && !project.currentProject?.locked_by_me)" class="lock-badge">{{ project.currentProject?.lock_holder_display_name || '다른 사용자' }} 편집 중</span><span v-else-if="project.leaseState === 'held'" class="lock-badge mine">내 편집 세션</span></div></div>
        <div><h2>{{ tree.name }}</h2><p>{{ tree.description || '설명 없음' }}</p></div>
        <dl><div><dt>최근 수정</dt><dd>{{ new Date(tree.updated_at).toLocaleString() }}</dd></div><div><dt>Revision</dt><dd>{{ tree.revision ?? project.currentRevision ?? 0 }}</dd></div></dl>
        <div class="tree-card-actions"><RouterLink class="button-link primary" :to="{ name: 'tree-editor', params: { projectId: route.params.projectId, treeId: tree.id } }">{{ project.currentRole === 'viewer' ? '보기' : '열기' }}</RouterLink><button v-if="project.canEditProject" @click="rename(tree)">이름 변경</button><button v-if="project.canEditProject && !tree.is_default" class="danger" @click="remove(tree)">삭제</button></div>
      </article>
      <section v-if="!project.alignTrees.length" class="panel tree-empty"><span>◇</span><h2>Align Tree가 없습니다.</h2><p v-if="project.canEditProject">새 Align Tree를 만들어 공정 관계 편집을 시작하세요.</p><p v-else>프로젝트 편집자가 Align Tree를 만들면 여기에 표시됩니다.</p><button v-if="project.canEditProject" class="primary" @click="creating = true">첫 Align Tree 만들기</button></section>
    </div>
  </section>
</template>
