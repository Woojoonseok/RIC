<script setup lang="ts">
import { X } from "@lucide/vue";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useAppStore } from "../../stores/app";
import { useGraphStore } from "../../stores/graph";

const app = useAppStore();
const graph = useGraphStore();
const boxLegend = ref<HTMLElement | null>(null);
const arrowLegend = ref<HTMLElement | null>(null);
const observers: ResizeObserver[] = [];

function storedSize(key: string) {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null") as { width?: number; height?: number } | null;
    if (!value?.width || !value?.height) return undefined;
    return { width: `${Math.max(180, Math.min(520, value.width))}px`, height: `${Math.max(100, Math.min(560, value.height))}px` };
  } catch { return undefined }
}

function observeSize(element: HTMLElement | null, key: string) {
  if (!element || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(([entry]) => {
    if (!entry || typeof localStorage === "undefined") return;
    const bounds = element.getBoundingClientRect();
    if (bounds.width < 180 || bounds.height < 100) return;
    localStorage.setItem(key, JSON.stringify({
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    }));
  });
  observer.observe(element);
  observers.push(observer);
}

onMounted(() => {
  observeSize(boxLegend.value, "ric-editor-box-preset-legend-size");
  observeSize(arrowLegend.value, "ric-editor-arrow-legend-size");
});
onBeforeUnmount(() => observers.splice(0).forEach((observer) => observer.disconnect()));

function dashArray(pattern: string) {
  if (pattern === "dashed") return "9 6";
  if (pattern === "dotted") return "2 5";
  if (pattern === "reference") return "10 4 2 4";
  return undefined;
}
</script>

<template>
  <div class="reference-legends">
    <section v-show="app.showBoxPresetLegend" ref="boxLegend" class="reference-legend box-preset-legend" :style="storedSize('ric-editor-box-preset-legend-size')">
      <header><strong>Box Preset</strong><button aria-label="Box Preset 닫기" title="Box Preset 닫기" @click="app.setLegendVisibility('box', false)"><X :size="14"/></button></header>
      <div class="box-preset-items">
        <div v-for="preset in graph.rawGraph?.box_presets" :key="preset.id" class="box-preset-item">
          <span class="box-preset-sample" :style="{ background: preset.fill_color, borderColor: preset.stroke_color, borderWidth: `${Math.min(preset.stroke_width, 4)}px` }"/>
          <span><b>{{ preset.name }}</b><small>{{ preset.width }} × {{ preset.height }}</small></span>
        </div>
      </div>
    </section>

    <section v-show="app.showArrowLegend" ref="arrowLegend" class="reference-legend arrow-legend" :style="storedSize('ric-editor-arrow-legend-size')">
      <header><strong>Arrow Legend</strong><button aria-label="Arrow Legend 닫기" title="Arrow Legend 닫기" @click="app.setLegendVisibility('arrow', false)"><X :size="14"/></button></header>
      <div class="arrow-legend-items">
        <div v-for="style in graph.rawGraph?.relation_styles" :key="style.id" class="arrow-legend-item">
          <svg viewBox="0 0 86 20" aria-hidden="true">
            <defs><marker :id="`legend-arrow-${style.id}`" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto"><path d="M0,0 L8,3.5 L0,7 Z" :fill="style.stroke_color"/></marker></defs>
            <line x1="4" y1="10" x2="78" y2="10" :stroke="style.stroke_color" :stroke-width="style.stroke_width" :stroke-dasharray="dashArray(style.line_pattern)" :marker-end="style.marker_type === 'arrow' ? `url(#legend-arrow-${style.id})` : undefined"/>
          </svg>
          <span>{{ style.name }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
