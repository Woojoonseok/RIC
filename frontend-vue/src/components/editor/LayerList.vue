<script setup lang="ts">
import { computed, ref } from "vue";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";
const app = useAppStore(); const graph = useGraphStore(); const query = ref("");
const layers = computed(() => graph.displayGraph?.layers.filter((row) => row.name.toLowerCase().includes(query.value.toLowerCase())) ?? []);
</script>
<template><aside class="layer-list"><div class="side-heading"><span>LAYERS</span><b>{{ layers.length }}</b></div><input v-model="query" class="side-search" placeholder="Layer 검색"><button v-for="layer in layers" :key="layer.id" class="layer-item" :class="{ active: app.selection.some((row) => row.kind === 'layer' && row.id === layer.id) }" @click="app.select({ kind: 'layer', id: layer.id }, $event.ctrlKey || $event.metaKey || $event.shiftKey)"><span class="layer-dot"/><span><strong>{{ layer.name.replaceAll('\n', ' · ') }}</strong><small>{{ layer.step || 'Step 미지정' }}</small></span><em v-if="graph.groupSizeByLayerId[layer.id]">{{ graph.groupSizeByLayerId[layer.id] }}</em></button><p v-if="!layers.length" class="empty">Layer가 없습니다.</p></aside></template>
