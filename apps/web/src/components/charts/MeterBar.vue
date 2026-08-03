<script setup lang="ts">
/** Criterion pass-rate meter: single-hue fill plus explicit % label. */
defineProps<{ value: number }>()
</script>

<template>
  <span class="relative inline-block h-2.5 w-full overflow-hidden rounded-[4px] bg-plane align-middle">
    <span class="absolute inset-y-0 left-0 rounded-r-[4px] bg-series" :style="{ width: `${Math.round(value * 100)}%` }" />
  </span>
</template>
