<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  points: Array<{ label: string; value: number }>
  ariaLabel?: string
}>()

const W = 640
const H = 240
const PAD = { top: 24, right: 18, bottom: 32, left: 42 }
const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom }
const gridY = [0, 0.25, 0.5, 0.75, 1]

const max = computed(() => Math.max(1, ...props.points.map((point) => point.value)))
const xy = computed(() =>
  props.points.map((point, index) => ({
    ...point,
    x: PAD.left + (props.points.length === 1 ? inner.w / 2 : (index / (props.points.length - 1)) * inner.w),
    y: PAD.top + (1 - point.value / max.value) * inner.h,
  })),
)

const linePath = computed(() =>
  xy.value.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
)
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
  xy.value.forEach((point, index) => {
    const dist = Math.abs(point.x - x)
    if (dist < bestDist) {
      best = index
      bestDist = dist
    }
  })
  hover.value = xy.value.length ? best : null
}
</script>

<template>
  <div class="relative">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="w-full"
      role="img"
      :aria-label="ariaLabel ?? 'Area chart'"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
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
          :key="`label-${g}`"
          :x="PAD.left - 8"
          :y="PAD.top + (1 - g) * inner.h + 4"
          text-anchor="end"
          class="fill-ink-3 text-sm"
        >
          {{ Math.round(g * max) }}
        </text>
      </g>

      <template v-if="xy.length === 1">
        <rect
          :x="PAD.left"
          :y="xy[0]!.y"
          :width="inner.w"
          :height="PAD.top + inner.h - xy[0]!.y"
          rx="4"
          class="fill-series/80"
        />
      </template>
      <template v-else>
        <path v-if="areaPath" :d="areaPath" class="fill-series/15" />
        <path v-if="linePath" :d="linePath" fill="none" class="stroke-series" stroke-width="2" stroke-linejoin="round" />
      </template>

      <g v-if="xy.length > 1">
        <text
          v-for="index in [0, Math.floor(xy.length / 2), xy.length - 1]"
          :key="index"
          :x="xy[index]!.x"
          :y="H - 8"
          text-anchor="middle"
          class="fill-ink-3 text-sm"
        >
          {{ xy[index]!.label }}
        </text>
      </g>

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
      class="pointer-events-none absolute top-2 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm shadow-sm"
      :style="{ left: `min(max(${(hoverPoint.x / W) * 100}% - 3rem, 0%), calc(100% - 8rem))` }"
    >
      <div class="font-medium">{{ hoverPoint.label }}</div>
      <div class="text-ink-2">{{ hoverPoint.value }} calls</div>
    </div>
  </div>
</template>
