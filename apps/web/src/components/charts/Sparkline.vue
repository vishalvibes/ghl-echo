<script setup lang="ts">
import { computed } from 'vue'

/** Tiny inline pass-rate trend. Values 0..1, oldest first. */
const props = defineProps<{ values: number[] }>()

const W = 72
const H = 20

const path = computed(() => {
  const v = props.values
  if (v.length < 2) return ''
  return v
    .map((value, index) => {
      const x = (index / (v.length - 1)) * (W - 4) + 2
      const y = 2 + (1 - value) * (H - 4)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})
</script>

<template>
  <svg v-if="path" :viewBox="`0 0 ${W} ${H}`" class="h-5 w-[72px]" aria-hidden="true">
    <path :d="path" fill="none" class="stroke-series" stroke-width="1.5" stroke-linejoin="round" />
  </svg>
  <span v-else class="text-xs text-ink-3">—</span>
</template>
