<script setup lang="ts">
import { computed, ref } from 'vue'

interface MetricChartSeries {
  label: string
  color: string
}

interface MetricChartPoint {
  label: string
  values: Array<number | null>
}

const props = withDefaults(defineProps<{
  points: MetricChartPoint[]
  series: MetricChartSeries[]
  min?: number
  max?: number
  format?: 'number' | 'percent' | 'score' | 'duration'
  ariaLabel?: string
}>(), {
  min: 0,
  format: 'number',
  ariaLabel: 'Metric trend',
})

const W = 640
const H = 220
const PAD = { top: 18, right: 18, bottom: 34, left: 48 }
const inner = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom }
const hover = ref<number | null>(null)

const observedMax = computed(() => Math.max(
  props.min + 1,
  ...props.points.flatMap((point) => point.values.filter((value): value is number => value != null)),
))
const ceiling = computed(() => props.max ?? observedMax.value)
const span = computed(() => Math.max(0.0001, ceiling.value - props.min))

function xAt(index: number) {
  return PAD.left + (props.points.length === 1 ? inner.w / 2 : (index / (props.points.length - 1)) * inner.w)
}

function yAt(value: number) {
  return PAD.top + (1 - (value - props.min) / span.value) * inner.h
}

const paths = computed(() => props.series.map((_, seriesIndex) => {
  let path = ''
  let drawing = false
  props.points.forEach((point, index) => {
    const value = point.values[seriesIndex]
    if (value == null) {
      drawing = false
      return
    }
    path += `${drawing ? ' L' : 'M'}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`
    drawing = true
  })
  return path
}))

const hoverPoint = computed(() => hover.value == null ? null : props.points[hover.value] ?? null)
const xLabelIndexes = computed(() => {
  if (props.points.length <= 1) return [0]
  return [...new Set([0, Math.floor(props.points.length / 2), props.points.length - 1])]
})

function formatValue(value: number | null) {
  if (value == null) return '—'
  if (props.format === 'percent') return `${Math.round(value * 100)}%`
  if (props.format === 'score') return `${value.toFixed(1)}/5`
  if (props.format === 'duration') {
    const rounded = Math.round(value)
    return rounded >= 60 ? `${Math.floor(rounded / 60)}m ${rounded % 60}s` : `${rounded}s`
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function onMove(event: MouseEvent) {
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * W
  let nearest = 0
  let distance = Infinity
  props.points.forEach((_, index) => {
    const next = Math.abs(xAt(index) - x)
    if (next < distance) {
      nearest = index
      distance = next
    }
  })
  hover.value = props.points.length ? nearest : null
}
</script>

<template>
  <div class="relative">
    <div class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      <span v-for="item in series" :key="item.label" class="inline-flex items-center gap-1.5">
        <span class="size-2 rounded-sm" :style="{ backgroundColor: item.color }" />
        {{ item.label }}
      </span>
    </div>
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      class="w-full"
      role="img"
      :aria-label="ariaLabel"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <g v-for="fraction in [0, 0.5, 1]" :key="fraction">
        <line
          :x1="PAD.left"
          :x2="W - PAD.right"
          :y1="PAD.top + (1 - fraction) * inner.h"
          :y2="PAD.top + (1 - fraction) * inner.h"
          class="stroke-hairline"
        />
        <text
          :x="PAD.left - 8"
          :y="PAD.top + (1 - fraction) * inner.h + 4"
          text-anchor="end"
          class="fill-ink-3 text-xs"
        >
          {{ formatValue(min + fraction * span) }}
        </text>
      </g>

      <text
        v-for="index in xLabelIndexes"
        :key="index"
        :x="xAt(index)"
        :y="H - 8"
        text-anchor="middle"
        class="fill-ink-3 text-xs"
      >
        {{ points[index]?.label }}
      </text>

      <path
        v-for="(path, index) in paths"
        :key="series[index]!.label"
        :d="path"
        fill="none"
        :stroke="series[index]!.color"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      <g v-if="hoverPoint && hover !== null">
        <line
          :x1="xAt(hover)"
          :x2="xAt(hover)"
          :y1="PAD.top"
          :y2="PAD.top + inner.h"
          class="stroke-baseline"
          stroke-dasharray="3 3"
        />
        <circle
          v-for="(value, index) in hoverPoint.values"
          v-show="value != null"
          :key="series[index]!.label"
          :cx="xAt(hover)"
          :cy="value == null ? 0 : yAt(value)"
          r="4"
          :fill="series[index]!.color"
          class="stroke-surface"
          stroke-width="2"
        />
      </g>
    </svg>

    <div
      v-if="hoverPoint && hover !== null"
      class="pointer-events-none absolute top-8 min-w-32 rounded-md border border-hairline bg-surface px-2.5 py-2 text-xs shadow-sm"
      :style="{ left: `min(max(${(xAt(hover) / W) * 100}% - 4rem, 0%), calc(100% - 9rem))` }"
    >
      <div class="mb-1 font-medium">{{ hoverPoint.label }}</div>
      <div v-for="(item, index) in series" :key="item.label" class="flex justify-between gap-3 text-ink-2">
        <span>{{ item.label }}</span>
        <span class="font-medium tabular-nums text-ink">{{ formatValue(hoverPoint.values[index] ?? null) }}</span>
      </div>
    </div>
  </div>
</template>
