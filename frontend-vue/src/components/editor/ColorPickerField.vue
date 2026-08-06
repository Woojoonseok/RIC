<script setup lang="ts">
import { Pipette } from "@lucide/vue";

defineProps<{ label: string; modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

interface EyeDropperResult { sRGBHex: string }
interface EyeDropperInstance { open: () => Promise<EyeDropperResult> }
interface EyeDropperConstructor { new (): EyeDropperInstance }

const eyeDropper = typeof window === "undefined"
  ? undefined
  : (window as typeof window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;

function inputColor(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}

async function pickScreenColor() {
  if (!eyeDropper) return;
  try {
    const result = await new eyeDropper().open();
    emit("update:modelValue", result.sRGBHex);
  } catch { /* User cancelled the picker. */ }
}
</script>

<template>
  <label class="property-color-row">
    {{ label }}
    <span class="property-color-control">
      <input
        class="property-color-input"
        type="color"
        :value="modelValue"
        :aria-label="`${label} color`"
        @input="inputColor"
      >
      <code>{{ modelValue.toUpperCase() }}</code>
      <button
        v-if="eyeDropper"
        type="button"
        class="property-color-pipette"
        :aria-label="`${label} 화면 색상 선택`"
        title="화면에서 색상 선택"
        @click.prevent="pickScreenColor"
      >
        <Pipette :size="15"/>
      </button>
    </span>
  </label>
</template>
