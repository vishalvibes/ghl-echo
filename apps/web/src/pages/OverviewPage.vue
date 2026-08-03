<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import type { AnalyticsWindow } from '@copilot/shared'
import { useOverview } from '../composables/queries.js'
import { duration, pct } from '../lib/format.js'
import Card from '../components/ui/Card.vue'
import StatTile from '../components/ui/StatTile.vue'
import WindowSelect from '../components/ui/WindowSelect.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'
import TrendChart from '../components/charts/TrendChart.vue'
import BarList from '../components/charts/BarList.vue'
import Sparkline from '../components/charts/Sparkline.vue'

const window = ref<AnalyticsWindow>('7d')
const { data, isLoading, isError } = useOverview(window)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-lg font-semibold">Overview</h1>
      <WindowSelect v-model="window" />
    </div>

    <LoadingBlock v-if="isLoading" />
    <EmptyState
      v-else-if="isError"
      title="Could not load the dashboard"
      detail="Check that the API is running and a session is available."
    />

    <template v-else-if="data">
      <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Calls" :value="String(data.kpis.calls)" />
        <StatTile
          label="Pass rate"
          :value="pct(data.kpis.passRate)"
          :delta-pts="Math.round(data.kpis.passRateDelta * 100)"
        />
        <StatTile
          label="Fail rate"
          :value="pct(data.kpis.failRate)"
          :delta-pts="-Math.round(data.kpis.passRateDelta * 100)"
          invert
        />
        <StatTile label="Open actions" :value="String(data.kpis.openActions)" />
        <StatTile label="Avg duration" :value="duration(data.kpis.avgDurationSec)" />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card title="Pass rate over time">
          <TrendChart v-if="data.trend.length" :points="data.trend" />
          <EmptyState v-else title="No evaluated calls in this window" />
        </Card>
        <Card title="Top failure modes" subtitle="Findings across all agents in the window">
          <BarList v-if="data.failureModes.length" :items="data.failureModes" />
          <EmptyState v-else title="No findings — nothing went wrong in this window" />
        </Card>
      </div>

      <Card title="Agents">
        <EmptyState
          v-if="data.agents.length === 0"
          title="No agents yet"
          detail="Install the app in a HighLevel location or run the seed to load demo agents."
        />
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-hairline text-left text-xs text-ink-3">
                <th class="py-2 pr-4 font-medium">Agent</th>
                <th class="py-2 pr-4 font-medium">Calls</th>
                <th class="py-2 pr-4 font-medium">Pass rate</th>
                <th class="py-2 pr-4 font-medium">Weakest criterion</th>
                <th class="py-2 pr-4 font-medium">Trend</th>
                <th class="py-2 font-medium">Open actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="agent in data.agents"
                :key="agent.id"
                class="border-b border-hairline last:border-0 hover:bg-plane"
              >
                <td class="py-2.5 pr-4">
                  <RouterLink :to="`/agents/${agent.id}`" class="font-medium text-series hover:underline">
                    {{ agent.name }}
                  </RouterLink>
                </td>
                <td class="py-2.5 pr-4 tabular-nums">{{ agent.calls }}</td>
                <td class="py-2.5 pr-4">
                  <span class="tabular-nums">{{ pct(agent.passRate) }}</span>
                  <span
                    v-if="Math.round(agent.passRateDelta * 100) !== 0"
                    class="ml-1.5 text-xs"
                    :class="agent.passRateDelta > 0 ? 'text-good-text' : 'text-critical'"
                  >
                    {{ agent.passRateDelta > 0 ? '▲' : '▼' }}{{ Math.abs(Math.round(agent.passRateDelta * 100)) }}
                  </span>
                </td>
                <td class="py-2.5 pr-4 text-ink-2">
                  <template v-if="agent.worstCriterion">
                    {{ agent.worstCriterion.label }}
                    <span class="text-xs text-ink-3">({{ pct(agent.worstCriterion.passRate) }})</span>
                  </template>
                  <span v-else class="text-ink-3">—</span>
                </td>
                <td class="py-2.5 pr-4"><Sparkline :values="agent.sparkline" /></td>
                <td class="py-2.5">
                  <span
                    v-if="agent.openActions > 0"
                    class="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium"
                  >
                    ⚠ {{ agent.openActions }}
                  </span>
                  <span v-else class="text-xs text-ink-3">0</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </template>
  </div>
</template>
