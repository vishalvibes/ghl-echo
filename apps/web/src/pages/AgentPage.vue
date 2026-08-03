<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Copy, RefreshCw, Sparkles } from 'lucide-vue-next'
import type { AnalyticsWindow } from '@copilot/shared'
import { useAgent, useRecommendations } from '../composables/queries.js'
import { pct } from '../lib/format.js'
import Card from '../components/ui/Card.vue'
import StatTile from '../components/ui/StatTile.vue'
import WindowSelect from '../components/ui/WindowSelect.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'
import TrendChart from '../components/charts/TrendChart.vue'
import BarList from '../components/charts/BarList.vue'
import MeterBar from '../components/charts/MeterBar.vue'

const route = useRoute()
const agentId = computed(() => String(route.params.id))
const window = ref<AnalyticsWindow>('7d')
const force = ref(false)

const { data: agent, isLoading } = useAgent(agentId, window)
const {
  data: recs,
  isLoading: recsLoading,
  isError: recsError,
  error: recsErrorValue,
  refetch: refetchRecs,
} = useRecommendations(agentId, window, force)

const llmDisabled = computed(() => {
  const err = recsErrorValue.value as { status?: number } | null
  return err?.status === 503
})

const copied = ref<number | null>(null)
async function copyPatch(rank: number, patch: string) {
  await navigator.clipboard.writeText(patch)
  copied.value = rank
  setTimeout(() => (copied.value = null), 1500)
}
</script>

<template>
  <div class="space-y-4">
    <LoadingBlock v-if="isLoading" />
    <template v-else-if="agent">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-xs text-ink-3"><RouterLink to="/" class="hover:underline">Overview</RouterLink> / Agent</div>
          <h1 class="text-lg font-semibold">{{ agent.name }}</h1>
        </div>
        <div class="flex items-center gap-2">
          <RouterLink
            :to="`/agents/${agent.id}/scorecard`"
            class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm hover:bg-plane"
          >
            Edit scorecard <span class="text-ink-3">v{{ agent.scorecardVersion }}</span>
          </RouterLink>
          <WindowSelect v-model="window" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Calls" :value="String(agent.kpis.calls)" />
        <StatTile
          label="Pass rate"
          :value="pct(agent.kpis.passRate)"
          :delta-pts="Math.round(agent.kpis.passRateDelta * 100)"
        />
        <StatTile label="Open actions" :value="String(agent.kpis.openActions)" />
        <StatTile label="Fail rate" :value="pct(agent.kpis.failRate)" invert />
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <Card title="Criterion breakdown" subtitle="Share of calls meeting each criterion — weakest first">
          <EmptyState v-if="agent.criteria.length === 0" title="No evaluations in this window" />
          <ul v-else class="space-y-3">
            <li v-for="criterion in agent.criteria" :key="criterion.key">
              <div class="mb-1 flex items-baseline justify-between text-sm">
                <span>
                  {{ criterion.label }}
                  <span class="text-xs text-ink-3">· w{{ criterion.weight }} · {{ criterion.evaluated }} calls</span>
                </span>
                <span class="tabular-nums">
                  {{ pct(criterion.passRate) }}
                  <span
                    v-if="Math.round(criterion.delta * 100) !== 0"
                    class="ml-1 text-xs"
                    :class="criterion.delta > 0 ? 'text-good-text' : 'text-critical'"
                  >
                    {{ criterion.delta > 0 ? '▲' : '▼' }}{{ Math.abs(Math.round(criterion.delta * 100)) }}
                  </span>
                </span>
              </div>
              <MeterBar :value="criterion.passRate" />
            </li>
          </ul>
        </Card>

        <div class="space-y-4">
          <Card title="Pass rate over time">
            <TrendChart v-if="agent.trend.length" :points="agent.trend" />
            <EmptyState v-else title="No evaluated calls in this window" />
          </Card>
          <Card title="Failure modes">
            <BarList v-if="agent.failureModes.length" :items="agent.failureModes" />
            <EmptyState v-else title="No findings in this window" />
          </Card>
        </div>
      </div>

      <Card
        title="Copilot recommendations"
        :subtitle="recs ? `Generated from ${recs.basedOnCalls} failed or partial calls${recs.cached ? ' · cached' : ''}` : undefined"
      >
        <template #actions>
          <button
            class="flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1 text-xs hover:bg-plane"
            @click="force = true; void refetchRecs()"
          >
            <RefreshCw class="size-3.5" aria-hidden="true" /> Regenerate
          </button>
        </template>

        <LoadingBlock v-if="recsLoading" />
        <EmptyState
          v-else-if="llmDisabled"
          title="LLM is disabled"
          detail="Set OPENAI_ENABLED=true and an API key in apps/api/.env to generate recommendations."
        />
        <EmptyState v-else-if="recsError" title="Could not generate recommendations" />
        <EmptyState
          v-else-if="recs && recs.items.length === 0"
          title="Nothing to fix"
          detail="No failure clusters in this window — the agent is meeting its criteria."
        />

        <ol v-else-if="recs" class="space-y-4">
          <li v-for="item in recs.items" :key="item.rank" class="rounded-lg border border-hairline p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-2">
                <Sparkles class="size-4 text-series" aria-hidden="true" />
                <h3 class="text-sm font-semibold">{{ item.rank }}. {{ item.title }}</h3>
              </div>
              <span class="shrink-0 rounded-full border border-hairline px-2 py-0.5 text-xs text-ink-2">
                {{ item.expectedImpact }} impact · {{ item.affectedCalls }} calls
              </span>
            </div>
            <p class="mt-2 text-sm text-ink-2">{{ item.diagnosis }}</p>
            <pre
              v-if="item.promptPatch"
              class="mt-3 overflow-x-auto rounded-md bg-plane p-3 text-xs leading-relaxed whitespace-pre-wrap"
            >{{ item.promptPatch }}</pre>
            <div class="mt-3 flex items-center gap-3 text-xs">
              <button
                v-if="item.promptPatch"
                class="flex items-center gap-1 rounded-md border border-hairline px-2 py-1 hover:bg-plane"
                @click="copyPatch(item.rank, item.promptPatch)"
              >
                <Copy class="size-3" aria-hidden="true" />
                {{ copied === item.rank ? 'Copied' : 'Copy patch' }}
              </button>
              <span class="text-ink-3">Evidence:</span>
              <RouterLink
                v-for="(callId, index) in item.evidenceCallIds"
                :key="callId"
                :to="`/calls/${callId}`"
                class="text-series hover:underline"
              >
                call {{ index + 1 }}
              </RouterLink>
            </div>
          </li>
        </ol>
      </Card>
    </template>
  </div>
</template>
