<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { layerMasterMatchesQuery } from "../../domain/layerMaster";
import { useGraphStore } from "../../stores/graph";
import { useReferenceStore } from "../../stores/reference";
import type { LayerMaster } from "../../types";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ confirm: [masters: LayerMaster[]]; close: [] }>();
const graph = useGraphStore();
const reference = useReferenceStore();
const search = ref("");
const selectedIds = ref<string[]>([]);
const importedIds = computed(() => new Set(
  graph.rawGraph?.layers.map((layer) => layer.layer_master_id).filter(Boolean) ?? [],
));
const filtered = computed(() => reference.layerMasters.filter(
  (master) => !importedIds.value.has(master.id)
    && layerMasterMatchesQuery(master, search.value),
));
const allFilteredSelected = computed(() => (
  filtered.value.length > 0
  && filtered.value.every((master) => selectedIds.value.includes(master.id))
));
const selectedMasters = computed(() => reference.layerMasters.filter(
  (master) => selectedIds.value.includes(master.id) && !importedIds.value.has(master.id),
));

async function load() { if (props.open) await reference.loadLayerMasters() }
function toggle(masterId: string) {
  selectedIds.value = selectedIds.value.includes(masterId)
    ? selectedIds.value.filter((id) => id !== masterId)
    : [...selectedIds.value, masterId];
}
function toggleAllFiltered() {
  const filteredIds = new Set(filtered.value.map((master) => master.id));
  selectedIds.value = allFilteredSelected.value
    ? selectedIds.value.filter((id) => !filteredIds.has(id))
    : [...new Set([...selectedIds.value, ...filteredIds])];
}
function confirm() {
  if (selectedMasters.value.length) emit("confirm", selectedMasters.value);
}
watch(() => props.open, () => {
  search.value = "";
  selectedIds.value = [];
  void load();
});
onMounted(load);
</script>

<template>
  <div v-if="open" class="paste-overlay" @click="emit('close')">
    <section class="panel paste-panel layer-select-panel" @click.stop>
      <div class="panel-heading"><h2>Layer 정보에서 가져오기</h2><button @click="emit('close')">취소</button></div>
      <input v-model="search" autofocus class="layer-select-search" placeholder="Layer명 또는 번호 검색...">
      <div class="layer-select-tools">
        <span>가져올 수 있는 Layer {{ filtered.length }}개</span>
        <button type="button" :disabled="!filtered.length" @click="toggleAllFiltered">
          {{ allFilteredSelected ? '전체 선택 해제' : '전체 선택' }}
        </button>
      </div>
      <div class="layer-select-list">
        <p v-if="!filtered.length" class="empty">가져올 Layer 정보가 없습니다.</p>
        <label
          v-for="master in filtered"
          :key="master.id"
          class="layer-select-option"
          :class="{ selected: selectedIds.includes(master.id) }"
        >
          <input type="checkbox" :checked="selectedIds.includes(master.id)" @change="toggle(master.id)">
          <span><strong>{{ master.name }}</strong><small>{{ master.layer_number ? `(${master.layer_number})` : 'Layer 번호 없음' }}</small></span>
        </label>
      </div>
      <div class="layer-select-actions">
        <span>{{ selectedMasters.length }}개 선택</span>
        <button class="primary" :disabled="!selectedMasters.length" @click="confirm">선택한 Layer 가져오기</button>
      </div>
    </section>
  </div>
</template>
