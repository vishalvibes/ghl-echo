<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TrendPoint } from '@copilot/shared'
import { shortDate } from '../../lib/format.js'

/**
 * Pass-rate over time. Single series (blue), area fill, hover crosshair with
 * tooltip. SVG only — no chart library needed at this size.
 */
const props = defineProps<{ points: TrendPoint[] }>()

const W = 640
const H = 180
const PAD = { top: 12, right: 12, bottom: 28, left: 44 }

const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom }

const xy = computed(() =>
  props.points.map((point, index) => ({
    ...point,
    x: PAD.left + (props.points.length === 1 ? inner.w / 2 : (index / (props.points.length - 1)) * inner.w),
    y: PAD.top + (1 - point.passRate) * inner.h,
  })),
)

const linePath = computed(() => xy.value.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
const areaPath = computed(() => {
  if (xy.value.length === 0) return ''
  const first = xy.value[0]!
  const last = xy.value[xy.value.length - 1]!
  const base = PAD.top + inner.h
  return `${linePath.value} L${last.x.toFixed(1)},${base} L${first.x.toFixed(1)},${base} Z`
})

const hover = ref<number | null>(null)
const hoverPoint = computed(() => (hover.value === null ? null : xy.value[hover.value] ?? null))

function onMove(event: MouseEvent) {
  const svg = event.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * W
  let best = 0
  let bestDist = Infinity
  xy.value.forEach((p, i) => {
    const d = Math.abs(p.x - x)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  hover.value = xy.value.length ? best : null
}

const gridY = [0, 0.25, 0.5, 0.75, 1]
</script>

<template>
  <div class="relative">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="w-full"
      role="img"
      aria-label="Pass rate trend"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <!-- grid -->
      <g>
        <line
          v-for="g in gridY"
          :key="g"
          :x1="PAD.left"
          :x2="W - PAD.right"
          :y1="PAD.top + (1 - g) * inner.h"
          :y2="PAD.top + (1 - g) * inner.h"
          class="stroke-hairline"
          stroke-width="1"
        />
        <text
          v-for="g in gridY"
          :key="`t${g}`"
          :x="PAD.left - 6"
          :y="PAD.top + (1 - g) * inner.h + 3"
          text-anchor="end"
          class="fill-ink-3 text-sm"
        >
          {{ Math.round(g * 100) }}%
        </text>
      </g>
      <!-- x labels: first, middle, last -->
      <g v-if="xy.length > 1">
        <text
          v-for="i in [0, Math.floor(xy.length / 2), xy.length - 1]"
          :key="i"
          :x="xy[i]!.x"
          :y="H - 6"
          text-anchor="middle"
          class="fill-ink-3 text-sm"
        >
          {{ shortDate(xy[i]!.date) }}
        </text>
      </g>
      <!-- series -->
      <path v-if="areaPath" :d="areaPath" class="fill-series/12" />
      <path v-if="linePath" :d="linePath" fill="none" class="stroke-series" stroke-width="2" stroke-linejoin="round" />
      <!-- hover -->
      <g v-if="hoverPoint">
        <line
          :x1="hoverPoint.x"
          :x2="hoverPoint.x"
          :y1="PAD.top"
          :y2="PAD.top + inner.h"
          class="stroke-baseline"
          stroke-width="1"
          stroke-dasharray="3 3"
        />
        <circle :cx="hoverPoint.x" :cy="hoverPoint.y" r="4" class="fill-series stroke-surface" stroke-width="2" />
      </g>
    </svg>
    <div
      v-if="hoverPoint"
      class="pointer-events-none absolute top-1 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm shadow-sm"
      :style="{ left: `min(max(${(hoverPoint.x / W) * 100}% - 3rem, 0%), calc(100% - 8rem))` }"
    >
      <div class="font-medium">{{ shortDate(hoverPoint.date) }}</div>
      <div class="text-ink-2">{{ Math.round(hoverPoint.passRate * 100) }}% pass · {{ hoverPoint.calls }} calls</div>
    </div>
  </div>
</template>
