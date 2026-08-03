<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { AlertTriangle, Check, X } from 'lucide-vue-next'
import { SEGMENT_ACTION_LABELS, FINDING_TYPE_LABELS } from '@copilot/shared'
import { useCall, useUpdateAction } from '../composables/queries.js'
import { dateTime, duration, turnStamp } from '../lib/format.js'
import Card from '../components/ui/Card.vue'
import VerdictBadge from '../components/ui/VerdictBadge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'

const route = useRoute()
const callId = computed(() => String(route.params.id))
const { data: call, isLoading } = useCall(callId)
const updateAction = useUpdateAction()

/** Turn ids to highlight, driven by hovering/clicking evidence in the panel. */
const highlighted = ref<Set<number>>(new Set())

function focusTurns(turnIds: number[]) {
  highlighted.value = new Set(turnIds)
  const first = turnIds[0]
  if (first !== undefined) {
    document.getElementById(`turn-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

/** Segment ranges → per-turn action flag for the transcript gutter. */
const actionTurns = computed(() => {
  const map = new Map<number, string>()
  for (const segment of call.value?.evaluation?.segments ?? []) {
    if (segment.status !== 'open') continue
    for (let id = segment.turnStart; id <= segment.turnEnd; id++) {
      map.set(id, SEGMENT_ACTION_LABELS[segment.actionType] ?? segment.actionType)
    }
  }
  return map
})

const severityClass: Record<string, string> = {
  high: 'text-critical',
  medium: 'text-serious',
  low: 'text-ink-2',
}

/**
 * Call-shape metrics derived from the stored transcript. GHL exposes no
 * per-turn timing, so everything here is counted from text — enough to answer
 * "did the agent dominate the call" and "did ASR fall over" without a model.
 */
const stats = computed(() => {
  const turns = call.value?.transcript ?? []
  const chars = (role: string) =>
    turns.filter((t) => t.role === role).reduce((sum, t) => sum + t.text.length, 0)
  const agentChars = chars('agent')
  const callerChars = chars('caller')
  const spoken = agentChars + callerChars
  return {
    turns: turns.length,
    agentShare: spoken > 0 ? Math.round((agentChars / spoken) * 100) : null,
    words: turns.reduce((sum, t) => sum + t.text.split(/\s+/).filter(Boolean).length, 0),
    // GHL's ASR writes this literal when it cannot make out the caller.
    unintelligible: turns.filter((t) => /\(unintelligible/i.test(t.text)).length,
  }
})

/** Thresholds mirrored from `isJudgeable` in apps/api/src/ingest/normalize.ts. */
const MIN_TURNS = 3
const MIN_CHARS = 80

/** Say why there is no score. "Queued or skipped" makes both look like a bug. */
const notScored = computed(() => {
  const c = call.value
  if (!c || c.evaluation) return null
  const chars = c.transcript.reduce((sum, t) => sum + t.text.length, 0)
  switch (c.ingestStatus) {
    case 'pending':
      return { title: 'Waiting to be scored', detail: 'Queued for the judge — this page updates once it lands.' }
    case 'skipped':
      return {
        title: 'Too short to score',
        detail: `${c.transcript.length} turns, ${chars} characters. Scoring needs at least ${MIN_TURNS} turns and ${MIN_CHARS} characters, so there is nothing to judge against the scorecard.`,
      }
    case 'failed':
      return { title: 'Scoring failed', detail: c.ingestError ?? 'The judge errored on this call.' }
    default:
      return { title: 'No scorecard', detail: 'This agent has no active scorecard, so nothing was evaluated.' }
  }
})
</script>

<template>
  <div class="space-y-4">
    <LoadingBlock v-if="isLoading" />
    <template v-else-if="call">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="text-xs text-ink-3">
            <RouterLink to="/calls" class="hover:underline">Calls</RouterLink> / {{ dateTime(call.startedAt) }}
          </div>
          <h1 class="flex items-center gap-3 text-lg font-semibold">
            <!-- Web/test calls carry no number, so "Unknown caller" would read
                 as missing data rather than the normal case that it is. -->
            {{ call.contactName ?? call.contactPhone ?? 'Web call' }}
            <VerdictBadge :verdict="call.verdict" />
            <span v-if="call.overallScore !== null" class="text-sm font-normal text-ink-2">
              {{ call.overallScore }}/100
            </span>
            <span
              v-if="call.isMock"
              class="rounded-full border border-hairline px-2 py-0.5 text-[10px] font-medium tracking-wide text-ink-3 uppercase"
            >
              Demo
            </span>
          </h1>
          <p class="text-xs text-ink-3">
            {{ call.agentName }} · {{ call.direction }} · {{ duration(call.durationSec) }} · {{ call.outcome }}
          </p>
        </div>
        <RouterLink
          :to="`/agents/${call.agentId}`"
          class="rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm hover:bg-plane"
        >
          Agent dashboard
        </RouterLink>
      </div>

      <!-- Counted from the transcript, so it is present even when the judge
           never ran — which is exactly when the page would otherwise be bare. -->
      <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-4">
        <div class="bg-surface px-4 py-2.5">
          <dt class="text-xs text-ink-3">Duration</dt>
          <dd class="text-sm font-medium tabular-nums">{{ duration(call.durationSec) }}</dd>
        </div>
        <div class="bg-surface px-4 py-2.5">
          <dt class="text-xs text-ink-3">Turns</dt>
          <dd class="text-sm font-medium tabular-nums">{{ stats.turns }}</dd>
        </div>
        <div class="bg-surface px-4 py-2.5">
          <dt class="text-xs text-ink-3">Agent talk share</dt>
          <dd class="text-sm font-medium tabular-nums">
            {{ stats.agentShare === null ? '—' : `${stats.agentShare}%` }}
          </dd>
        </div>
        <div class="bg-surface px-4 py-2.5">
          <dt class="text-xs text-ink-3">Unclear audio</dt>
          <dd class="text-sm font-medium tabular-nums" :class="stats.unintelligible > 0 ? 'text-serious' : ''">
            {{ stats.unintelligible }}
          </dd>
        </div>
      </dl>

      <p v-if="call.evaluation" class="rounded-lg border border-hairline bg-surface px-4 py-3 text-sm text-ink-2">
        {{ call.evaluation.summary }}
        <span class="text-xs text-ink-3">
          · sentiment {{ call.evaluation.callerSentiment }} · scorecard v{{ call.evaluation.scorecardVersion }} ·
          {{ call.evaluation.model }}
        </span>
      </p>

      <div class="grid gap-4 lg:grid-cols-5">
        <!-- Transcript -->
        <Card title="Transcript" class="lg:col-span-3">
          <EmptyState v-if="call.transcript.length === 0" title="No transcript on this call" />
          <ol v-else class="space-y-1.5">
            <li
              v-for="turn in call.transcript"
              :id="`turn-${turn.id}`"
              :key="turn.id"
              class="rounded-md px-2.5 py-1.5 text-sm transition-colors"
              :class="[
                highlighted.has(turn.id) ? 'bg-series-soft' : '',
                actionTurns.has(turn.id) ? 'border-l-2 border-warning' : '',
              ]"
            >
              <div class="flex items-baseline gap-2.5">
                <span class="w-8 shrink-0 text-right text-[10px] tabular-nums text-ink-3">
                  {{ turnStamp(turn.startMs) || turn.id }}
                </span>
                <span
                  class="w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold tracking-wide uppercase"
                  :class="
                    turn.role === 'agent'
                      ? 'bg-series-soft text-series'
                      : turn.role === 'caller'
                        ? 'bg-plane text-ink'
                        : 'text-ink-3'
                  "
                >
                  {{ turn.role === 'agent' ? 'Agent' : turn.role === 'caller' ? 'Caller' : 'Sys' }}
                </span>
                <span class="text-ink" :class="turn.role === 'caller' ? 'font-medium' : ''">{{ turn.text }}</span>
              </div>
              <div v-if="actionTurns.has(turn.id)" class="ml-12 mt-0.5 flex items-center gap-1 text-[10px] font-medium text-ink-2">
                <AlertTriangle class="size-3 text-warning" aria-hidden="true" />
                {{ actionTurns.get(turn.id) }}
              </div>
            </li>
          </ol>
        </Card>

        <!-- Evidence panel -->
        <div class="space-y-4 lg:col-span-2">
          <Card title="Scorecard">
            <EmptyState v-if="notScored" :title="notScored.title" :detail="notScored.detail" />
            <ul v-else-if="call.evaluation" class="space-y-2.5">
              <li v-for="criterion in call.evaluation.criteria" :key="criterion.key">
                <button
                  class="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-plane"
                  :disabled="criterion.evidenceTurnIds.length === 0"
                  @click="focusTurns(criterion.evidenceTurnIds)"
                >
                  <Check v-if="criterion.met" class="mt-0.5 size-4 shrink-0 text-good" aria-label="Met" />
                  <X v-else class="mt-0.5 size-4 shrink-0 text-critical" aria-label="Not met" />
                  <span>
                    <span class="font-medium">{{ criterion.label }}</span>
                    <span v-if="criterion.value" class="text-xs text-ink-3"> · {{ criterion.value }}</span>
                    <span v-if="criterion.confidence < 0.6" class="ml-1 text-xs text-serious">low confidence</span>
                    <span class="block text-xs text-ink-2">{{ criterion.rationale }}</span>
                    <span v-if="criterion.evidenceTurnIds.length" class="block text-[10px] text-series">
                      show evidence
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          </Card>

          <Card v-if="call.evaluation && call.evaluation.findings.length" title="Findings">
            <ul class="space-y-3">
              <li v-for="finding in call.evaluation.findings" :key="finding.id">
                <button class="w-full rounded-md px-1.5 py-1 text-left hover:bg-plane" @click="focusTurns(finding.turnIds)">
                  <div class="flex items-center gap-1.5 text-sm font-medium">
                    <span :class="severityClass[finding.severity]" aria-hidden="true">●</span>
                    {{ finding.title }}
                    <span class="text-[10px] uppercase text-ink-3">{{ finding.severity }}</span>
                  </div>
                  <p class="mt-0.5 text-xs text-ink-2">{{ finding.detail }}</p>
                  <p v-if="finding.quote" class="mt-1 border-l-2 border-hairline pl-2 text-xs italic text-ink-3">
                    “{{ finding.quote }}”
                  </p>
                  <span class="text-[10px] text-ink-3">{{ FINDING_TYPE_LABELS[finding.type] ?? finding.type }}</span>
                </button>
              </li>
            </ul>
          </Card>

          <Card v-if="call.evaluation && call.evaluation.segments.length" title="Use actions">
            <ul class="space-y-2.5">
              <li v-for="segment in call.evaluation.segments" :key="segment.id" class="text-sm">
                <div class="flex items-start justify-between gap-2">
                  <button class="text-left hover:underline" @click="focusTurns([segment.turnStart])">
                    <span class="font-medium">{{ SEGMENT_ACTION_LABELS[segment.actionType] ?? segment.actionType }}</span>
                    <span class="block text-xs text-ink-2">{{ segment.reason }}</span>
                    <span class="text-[10px] text-ink-3">turns {{ segment.turnStart }}–{{ segment.turnEnd }}</span>
                  </button>
                  <div class="flex shrink-0 gap-1">
                    <button
                      v-if="segment.status === 'open'"
                      class="rounded-md border border-hairline px-2 py-0.5 text-xs hover:bg-plane"
                      @click="updateAction.mutate({ id: segment.id, status: 'done' })"
                    >
                      Done
                    </button>
                    <span v-else class="text-xs text-ink-3">{{ segment.status }}</span>
                  </div>
                </div>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </template>
  </div>
</template>
