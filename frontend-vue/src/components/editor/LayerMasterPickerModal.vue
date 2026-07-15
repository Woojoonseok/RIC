<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useReferenceStore } from "../../stores/reference";
import type { LayerMaster } from "../../types";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ confirm: [master: LayerMaster]; close: [] }>();
const reference = useReferenceStore();
const search = ref("");
const filtered = computed(() => reference.layerMasters.filter((master) => master.name.toLowerCase().includes(search.value.toLowerCase())));

async function load() { if (props.open) await reference.loadAll() }
watch(() => props.open, () => { search.value = ""; void load() });
onMounted(load);
</script>

<template>
  <div v-if="open" class="paste-overlay" @click="emit('close')">
    <section class="panel paste-panel layer-select-panel" @click.stop>
      <div class="panel-heading"><h2>Layer정보에서 가져오기</h2><button @click="emit('close')">취소</button></div>
      <input v-model="search" autofocus class="layer-select-search" placeholder="Layer명 검색...">
      <div class="layer-select-list">
        <p v-if="!filtered.length" class="empty">검색 결과가 없습니다.</p>
        <button v-for="master in filtered" :key="master.id" class="layer-select-option" @click="emit('confirm', master)">
          <strong>{{ master.name }}</strong><small>{{ master.layer_number ? `(${master.layer_number})` : 'Layer 번호 없음' }}</small>
        </button>
      </div>
    </section>
  </div>
</template>
