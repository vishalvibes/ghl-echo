<script setup lang="ts">
import type { AnalyticsWindow } from '@copilot/shared'
import Select from './Select.vue'

const model = defineModel<AnalyticsWindow>({ required: true })
const options: Array<{ value: AnalyticsWindow; label: string }> = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
]
</script>

<template>
  <Select v-model="model" :options="options" aria-label="Time window" />
</template>
