<script setup lang="ts">
import { computed } from "vue";
import { AlertTriangle, ArrowDown, ArrowUp, Trash2, X } from "@lucide/vue";
import { useGraphStore } from "../../stores/graph";

const graph = useGraphStore();
const impact = computed(() => graph.deleteImpact);
const isLayerImpact = computed(() => Boolean(impact.value && "layer" in impact.value));
const targetName = computed(() => {
  if (!impact.value) return "";
  return "layer" in impact.value ? impact.value.layer.name : impact.value.relation.label;
});
</script>

<template>
  <div v-if="impact" class="paste-overlay layer-impact-overlay" @click.self="graph.finishDeleteImpact(false)">
    <section class="panel layer-impact-modal">
      <header class="layer-impact-modal-heading">
        <div class="layer-impact-alert"><AlertTriangle :size="21"/></div>
        <div><p class="eyebrow">DELETE IMPACT</p><h2>{{ targetName }} 삭제 영향</h2><span>삭제 전에 연결 데이터와 산출물 영향을 확인하세요.</span></div>
        <button title="닫기" aria-label="닫기" @click="graph.finishDeleteImpact(false)"><X :size="18"/></button>
      </header>

      <div class="layer-impact-modal-metrics">
        <div><span>Upstream</span><strong>{{ impact.upstream_layers.length }}</strong></div>
        <div><span>Downstream</span><strong>{{ impact.downstream_layers.length }}</strong></div>
        <div><span>Overlay Key</span><strong>{{ impact.overlay_key_count }}</strong></div>
        <div><span>Export 행</span><strong>{{ impact.export_row_count }}</strong></div>
      </div>

      <div class="layer-impact-modal-body">
        <section>
          <h3><ArrowUp :size="14"/> 연결 경로</h3>
          <p v-if="!impact.upstream_layers.length && !impact.downstream_layers.length" class="empty">연결된 상·하위 Layer가 없습니다.</p>
          <div v-if="impact.upstream_layers.length" class="impact-name-row"><b>Upstream</b><span>{{ impact.upstream_layers.map(row => row.name).join(', ') }}</span></div>
          <div v-if="impact.downstream_layers.length" class="impact-name-row"><b>Downstream</b><span>{{ impact.downstream_layers.map(row => row.name).join(', ') }}</span></div>
        </section>
        <section>
          <h3><Trash2 :size="14"/> 함께 삭제되는 Relation {{ impact.direct_relations.length }}개</h3>
          <p v-if="!impact.direct_relations.length" class="empty">함께 삭제되는 Relation이 없습니다.</p>
          <div v-for="row in impact.direct_relations" :key="row.id" class="impact-relation-row"><span>{{ row.label }}</span><small>{{ row.relation_type }}</small></div>
        </section>
        <section v-if="impact.attachment_relations.length" class="impact-detach-section">
          <h3><AlertTriangle :size="14"/> 연결 대상이 해제되는 attachment {{ impact.attachment_relations.length }}개</h3>
          <div v-for="row in impact.attachment_relations" :key="row.id" class="impact-relation-row"><span>{{ row.label }}</span><small>{{ row.id.slice(0, 8) }}</small></div>
        </section>
        <section v-if="impact.saved_table_value_count">
          <h3><ArrowDown :size="14"/> 저장된 Table 값</h3>
          <p class="impact-table-note">{{ isLayerImpact ? 'Process, GDS, Overlay Key Table' : 'Overlay Key Table' }} 값 {{ impact.saved_table_value_count }}개가 함께 정리됩니다.</p>
        </section>
        <section v-if="impact.validation_rules.length">
          <h3><AlertTriangle :size="14"/> 영향받는 검증 규칙 {{ impact.validation_rules.length }}개</h3>
          <div v-for="rule in impact.validation_rules" :key="rule.id" class="impact-rule-row"><b :class="rule.severity">{{ rule.severity === 'error' ? '오류' : '경고' }}</b><span>{{ rule.name }}</span><small>{{ rule.field_name }}</small></div>
        </section>
      </div>

      <footer class="layer-impact-modal-actions">
        <button @click="graph.finishDeleteImpact(false)">취소</button>
        <button class="danger-button" @click="graph.finishDeleteImpact(true)"><Trash2 :size="15"/> {{ isLayerImpact ? 'Layer' : 'Relation' }} 삭제</button>
      </footer>
    </section>
  </div>
</template>
