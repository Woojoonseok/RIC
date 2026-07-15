<script setup lang="ts">
import { computed, ref } from "vue";
import { useEditorStore } from "../../stores/editor";
const store = useEditorStore(); const query = ref("");
const layers = computed(() => store.displayGraph?.layers.filter((row) => row.name.toLowerCase().includes(query.value.toLowerCase())) ?? []);
</script>
<template><aside class="layer-list"><div class="side-heading"><span>LAYERS</span><b>{{ layers.length }}</b></div><input v-model="query" class="side-search" placeholder="Layer 검색"><button v-for="layer in layers" :key="layer.id" class="layer-item" :class="{ active: store.selection.some((row) => row.kind === 'layer' && row.id === layer.id) }" @click="store.select({ kind: 'layer', id: layer.id }, $event.ctrlKey || $event.metaKey || $event.shiftKey)"><span class="layer-dot"/><span><strong>{{ layer.name.replaceAll('\n', ' · ') }}</strong><small>{{ layer.step || 'Step 미지정' }}</small></span><em v-if="store.groupSizeByLayerId[layer.id]">{{ store.groupSizeByLayerId[layer.id] }}</em></button><p v-if="!layers.length" class="empty">Layer가 없습니다.</p></aside></template>
