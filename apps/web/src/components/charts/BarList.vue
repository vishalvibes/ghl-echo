<script setup lang="ts">
import { computed } from 'vue'

/**
 * Horizontal magnitude bars with direct labels — failure-mode ranking.
 * Single hue (magnitude, not identity), value labeled on every row since the
 * whole point is comparing counts.
 */
const props = defineProps<{ items: Array<{ label: string; count: number }> }>()

const max = computed(() => Math.max(1, ...props.items.map((i) => i.count)))
</script>

<template>
  <ul class="space-y-2">
    <li v-for="item in items" :key="item.label" class="flex items-center gap-2 text-sm">
      <span class="w-40 shrink-0 truncate text-ink-2" :title="item.label">{{ item.label }}</span>
      <span class="relative h-4 flex-1 overflow-hidden rounded-[4px] bg-plane">
        <span
          class="absolute inset-y-0 left-0 rounded-r-[4px] bg-series"
          :style="{ width: `${(item.count / max) * 100}%` }"
        />
      </span>
      <span class="w-8 text-right text-sm tabular-nums text-ink-2">{{ item.count }}</span>
    </li>
  </ul>
</template>
