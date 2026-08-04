<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AnalyticsWindow, CallMetricTrendPoint } from '@copilot/shared'
import { useOverview } from '../composables/queries.js'
import { duration, pct } from '../lib/format.js'
import Card from '../components/ui/Card.vue'
import StatTile from '../components/ui/StatTile.vue'
import WindowSelect from '../components/ui/WindowSelect.vue'
import AgentSelect from '../components/ui/AgentSelect.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'
import AreaChart from '../components/charts/AreaChart.vue'
import MetricTrendCard from '../components/overview/MetricTrendCard.vue'
import BarList from '../components/charts/BarList.vue'
import TrendChart from '../components/charts/TrendChart.vue'

const window = ref<AnalyticsWindow>('7d')
const agentId = ref('')
const { data, isLoading, isError } = useOverview(window, agentId)

function percentOrDash(value: number | null) {
  return value == null ? '—' : pct(value)
}

function scoreOrDash(value: number | null) {
  return value == null ? '—' : `${value}/5`
}

const latestMetrics = computed(() => data.value?.metricTrend.at(-1))

const callVolumePoints = computed(() =>
  data.value?.trend.map((point) => ({ label: new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: point.calls })) ?? [],
)

type TrendMetricKey = keyof Pick<CallMetricTrendPoint,
  | 'completionRate' | 'resolvedRate' | 'prematureHangupRate'
  | 'scriptAdherence' | 'comprehension' | 'tone'
  | 'agentTalkShare' | 'interruptionRate' | 'callerRepeatRate'
  | 'positiveSentimentRate' | 'neutralSentimentRate' | 'negativeSentimentRate'
  | 'avgDurationSec'>
interface TrendSeries { key: TrendMetricKey; label: string; color: string }

const outcomeSeries: TrendSeries[] = [
  { key: 'completionRate', label: 'Completed', color: '#188bf6' },
  { key: 'resolvedRate', label: 'Resolved', color: '#0ca30c' },
  { key: 'prematureHangupRate', label: 'Premature hangup', color: '#ec835a' },
]
const qualitySeries: TrendSeries[] = [
  { key: 'scriptAdherence', label: 'Script', color: '#188bf6' },
  { key: 'comprehension', label: 'Comprehension', color: '#0f9f9a' },
  { key: 'tone', label: 'Tone', color: '#ec835a' },
]
const mechanicsSeries: TrendSeries[] = [
  { key: 'agentTalkShare', label: 'Agent talk share', color: '#188bf6' },
  { key: 'interruptionRate', label: 'Interruptions', color: '#ec835a' },
  { key: 'callerRepeatRate', label: 'Caller repeats', color: '#8b93a1' },
]
const sentimentSeries: TrendSeries[] = [
  { key: 'positiveSentimentRate', label: 'Positive', color: '#0ca30c' },
  { key: 'neutralSentimentRate', label: 'Neutral', color: '#8b93a1' },
  { key: 'negativeSentimentRate', label: 'Negative', color: '#ec835a' },
]
const durationSeries: TrendSeries[] = [{ key: 'avgDurationSec', label: 'Average duration', color: '#188bf6' }]
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-semibold">Overview</h1>
      <div class="flex items-center gap-2">
        <AgentSelect v-model="agentId" />
        <WindowSelect v-model="window" />
      </div>
    </div>

    <LoadingBlock v-if="isLoading" />
    <EmptyState
      v-else-if="isError"
      title="Could not load the dashboard"
      detail="Check that the API is running and a session is available."
    />

    <template v-else-if="data">
      <EmptyState
        v-if="data.kpis.calls === 0"
        title="Start using your Voice AI agents"
        detail="Call analytics will appear after your agents handle conversations."
      />

      <template v-else>
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Calls" :value="String(data.kpis.calls)" />
          <StatTile label="Evaluated calls" :value="String(data.kpis.evaluatedCalls)" />
          <template v-if="data.kpis.evaluatedCalls > 0">
            <StatTile
              label="Pass rate"
              :value="pct(data.kpis.passRate)"
              :delta-pts="Math.round(data.kpis.passRateDelta * 100)"
            />
            <StatTile label="Fail rate" :value="pct(data.kpis.failRate)" invert />
          </template>
          <StatTile label="Open review flags" :value="String(data.kpis.openActions)" />
          <StatTile label="Avg duration" :value="duration(data.kpis.avgDurationSec)" />
          <StatTile label="Completion" :value="percentOrDash(latestMetrics?.completionRate ?? null)" />
          <StatTile label="Script score" :value="scoreOrDash(latestMetrics?.scriptAdherence ?? null)" />
          <StatTile label="Positive sentiment" :value="percentOrDash(latestMetrics?.positiveSentimentRate ?? null)" />
          <StatTile label="Average turns" :value="latestMetrics?.avgTurns == null ? '—' : String(latestMetrics.avgTurns)" />
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <Card title="Call volume" :header-divider="false" :flush="!callVolumePoints.length">
            <AreaChart v-if="callVolumePoints.length" :points="callVolumePoints" aria-label="Call volume over time" />
            <p v-else class="py-2 text-center text-sm text-ink-3">No data yet</p>
          </Card>

          <MetricTrendCard
            title="Average call duration"
            :points="data.metricTrend"
            :series="durationSeries"
            format="duration"
          />
          <MetricTrendCard
            title="Caller sentiment"
            :points="data.metricTrend"
            :series="sentimentSeries"
            :max="1"
            format="percent"
          />
          <MetricTrendCard
            title="Quality ratings"
            :points="data.metricTrend"
            :series="qualitySeries"
            :min="1"
            :max="5"
            format="score"
          />
          <MetricTrendCard
            title="Conversation signals"
            :points="data.metricTrend"
            :series="mechanicsSeries"
            :max="1"
            format="percent"
          />
          <MetricTrendCard
            title="Call outcomes"
            :points="data.metricTrend"
            :series="outcomeSeries"
            :max="1"
            format="percent"
          />
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <Card title="Success criteria over time" subtitle="Share of evaluated calls that passed the active scorecard">
            <TrendChart v-if="data.trend.length" :points="data.trend" />
            <EmptyState v-else title="No evaluated calls in this window" />
          </Card>
          <Card title="Top failure modes" subtitle="Deviations, failures, and missed opportunities in this view">
            <BarList v-if="data.failureModes.length" :items="data.failureModes" />
            <EmptyState v-else title="No findings in this window" />
          </Card>
        </div>

      </template>
    </template>
  </div>
</template>
