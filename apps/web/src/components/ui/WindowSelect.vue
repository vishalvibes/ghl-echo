<script setup lang="ts">
import type { AnalyticsWindow } from '@copilot/shared'

const model = defineModel<AnalyticsWindow>({ required: true })
const options: Array<{ value: AnalyticsWindow; label: string }> = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
]
</script>

<template>
  <select
    v-model="model"
    class="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink"
    aria-label="Time window"
  >
    <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
  </select>
</template>
