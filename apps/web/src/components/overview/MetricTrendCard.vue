<script setup lang="ts">
import { computed } from 'vue'
import type { CallMetricTrendPoint } from '@copilot/shared'
import Card from '../ui/Card.vue'
import MetricLineChart from '../charts/MetricLineChart.vue'

interface MetricChartPoint {
  label: string
  values: Array<number | null>
}

type NumericTrendKey = Exclude<{
  [K in keyof CallMetricTrendPoint]: CallMetricTrendPoint[K] extends number | null ? K : never
}[keyof CallMetricTrendPoint], undefined>

interface SeriesDefinition {
  key: NumericTrendKey
  label: string
  color: string
}

const props = withDefaults(defineProps<{
  title: string
  points: CallMetricTrendPoint[]
  series: SeriesDefinition[]
  min?: number
  max?: number
  format?: 'number' | 'percent' | 'score' | 'duration'
}>(), {
  min: 0,
  format: 'number',
})

const chartPoints = computed<MetricChartPoint[]>(() => props.points.map((point) => ({
  label: new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  values: props.series.map((series) => point[series.key] as number | null),
})))
const hasData = computed(() => chartPoints.value.some((point) => point.values.some((value) => value != null)))
</script>

<template>
  <Card :title="title" :header-divider="false" :flush="!hasData">
    <MetricLineChart
      v-if="hasData"
      :points="chartPoints"
      :series="series"
      :min="min"
      :max="max"
      :format="format"
      :aria-label="`${title} cumulative trend`"
    />
    <p v-else class="py-2 text-center text-xs text-ink-3">No data yet</p>
  </Card>
</template>
