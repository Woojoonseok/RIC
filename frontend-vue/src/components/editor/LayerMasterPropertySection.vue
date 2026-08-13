<script setup lang="ts">
import { Maximize2 } from "@lucide/vue";
import { api } from "../../api/client";
import { useGraphStore } from "../../stores/graph";
import { useProjectStore } from "../../stores/project";
import { useReferenceStore } from "../../stores/reference";
import type { LayerMaster, LayerMasterUpdate } from "../../types";

const props = defineProps<{ layerMaster: LayerMaster | null; expanded: boolean }>();
const emit = defineEmits<{ toggleExpanded: [] }>();
const graph = useGraphStore();
const project = useProjectStore();
const reference = useReferenceStore();

function value(event: Event) {
  return (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
}

async function updateLayerMaster(body: LayerMasterUpdate) {
  const master = props.layerMaster;
  if (!master) return;
  await graph.mutateGraph("Layer 정보 저장", async () => {
    const saved = await api.updateLayerMaster(master.id, body);
    reference.syncLayerMaster(saved);
  }, false);
}

async function updatePriority(layoutId: string, nextValue: string) {
  if (!props.layerMaster) return;
  await updateLayerMaster({
    priorities: { ...props.layerMaster.priorities, [layoutId]: nextValue || null },
  });
}
</script>

<template>
  <section class="property-section layer-master-property-section">
    <div class="property-section-heading">
      <div><h3>Layer 정보</h3><small>공정 기준정보</small></div>
      <button v-if="!expanded && layerMaster" type="button" @click="emit('toggleExpanded')"><Maximize2 :size="13"/> 넓게 편집</button>
    </div>
    <template v-if="layerMaster">
      <p class="layer-master-sync-note">변경 내용은 이 Layer 정보가 사용된 모든 Key Editor에 반영됩니다.</p>
      <button v-if="!expanded" type="button" class="layer-master-open-card" @click="emit('toggleExpanded')">
        <span><strong>Mask · Workflow · 검증 정보</strong><small>세부 항목과 Key 우선순위를 넓은 화면에서 편집합니다.</small></span>
        <span>›</span>
      </button>
      <div v-else class="layer-master-fields">
        <label>Mask MAIN FLD<input :value="layerMaster.mask_main_fld || ''" @change="updateLayerMaster({ mask_main_fld: value($event) || null })"></label>
        <label>Mask SL FLD<input :value="layerMaster.mask_sl_fld || ''" @change="updateLayerMaster({ mask_sl_fld: value($event) || null })"></label>
        <label>Mask PR<input :value="layerMaster.pr_wf || ''" @change="updateLayerMaster({ pr_wf: value($event) || null })"></label>
        <label>WF Dev<input :value="layerMaster.dev_wf || ''" @change="updateLayerMaster({ dev_wf: value($event) || null })"></label>
        <label>WF PR 종류<input :value="layerMaster.pr_type || ''" @change="updateLayerMaster({ pr_type: value($event) || null })"></label>
        <label>광원<select :value="layerMaster.light_source || ''" @change="updateLayerMaster({ light_source: value($event) || null })"><option value="">미지정</option><option v-for="preset in reference.boxPresets" :key="preset.id" :value="preset.name">{{ preset.name }}</option></select></label>
        <label>PR Open/Close<select :value="layerMaster.pr_open_close || ''" @change="updateLayerMaster({ pr_open_close: value($event) || null })"><option value="">미지정</option><option value="Open">Open (O)</option><option value="Close">Close (X)</option></select></label>
        <label>검증 Rule<input :value="layerMaster.validation_rule || ''" @change="updateLayerMaster({ validation_rule: value($event) || null })"></label>
        <label class="property-textarea-row layer-master-comment">Comment<textarea :value="layerMaster.comment || ''" @change="updateLayerMaster({ comment: value($event) || null })"/></label>
        <div v-if="reference.keyLayoutTypes.length" class="layer-priority-fields">
          <div><strong>Key 우선순위</strong><small>Key 배치 Type별 우선순위</small></div>
          <label v-for="layoutType in reference.keyLayoutTypes" :key="layoutType.id">{{ layoutType.name }}<input :value="layerMaster.priorities[layoutType.id] || ''" @change="updatePriority(layoutType.id, value($event))"></label>
        </div>
      </div>
    </template>
    <p v-else class="layer-master-missing">연결된 Layer 정보가 없습니다.</p>
  </section>
</template>
