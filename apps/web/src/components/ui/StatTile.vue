<script setup lang="ts">
defineProps<{
  label: string
  value: string
  /** Signed delta in points; positive renders as improvement. */
  deltaPts?: number
  /** Invert coloring when a rising number is bad (e.g. fail rate). */
  invert?: boolean
}>()
</script>

<template>
  <div class="rounded-lg border border-hairline bg-surface px-4 py-3">
    <div class="text-sm text-ink-3">{{ label }}</div>
    <div class="mt-1 flex items-baseline gap-2">
      <span class="text-2xl font-semibold">{{ value }}</span>
      <span
        v-if="deltaPts !== undefined && deltaPts !== 0"
        class="text-sm font-medium"
        :class="(invert ? deltaPts < 0 : deltaPts > 0) ? 'text-good-text' : 'text-critical'"
      >
        {{ deltaPts > 0 ? '▲' : '▼' }} {{ Math.abs(deltaPts) }}pt
      </span>
    </div>
  </div>
</template>
