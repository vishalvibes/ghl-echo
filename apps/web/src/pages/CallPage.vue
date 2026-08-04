<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { AlertTriangle, ArrowLeft, LoaderCircle } from 'lucide-vue-next'
import {
  SEGMENT_ACTION_LABELS,
} from '@copilot/shared'
import { useCall, useUpdateAction } from '../composables/queries.js'
import { dateTime, duration, turnStamp } from '../lib/format.js'
import Card from '../components/ui/Card.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'

const route = useRoute()
const callId = computed(() => String(route.params.id))
const { data: call, isLoading } = useCall(callId)
const updateAction = useUpdateAction()
const callsBackTarget = computed(() =>
  route.query.from === 'flagged'
    ? { path: '/calls', query: { flagged: 'true' } }
    : { path: '/calls' },
)

/** Turn ids to highlight, driven by clicking evidence / use actions in the panel. */
const highlighted = ref<Set<number>>(new Set())

function focusTurns(turnIds: number[]) {
  highlighted.value = new Set(turnIds)
  const first = turnIds[0]
  if (first !== undefined) {
    document.getElementById(`turn-${first}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

/** Expand a use-action segment to every turn it covers, then focus that range. */
function focusSegment(segment: { turnStart: number; turnEnd: number }) {
  const ids: number[] = []
  for (let id = segment.turnStart; id <= segment.turnEnd; id++) ids.push(id)
  focusTurns(ids)
}

/**
 * Open use actions for the transcript: rings on every covered turn, but the
 * label chip only on the first turn of each segment so a 3-turn range does not
 * print "Human follow-up" three times.
 */
const useActions = computed(() => {
  const inRange = new Set<number>()
  const startLabels = new Map<number, string[]>()
  for (const segment of call.value?.evaluation?.segments ?? []) {
    if (segment.status !== 'open') continue
    const label = SEGMENT_ACTION_LABELS[segment.actionType] ?? segment.actionType
    for (let id = segment.turnStart; id <= segment.turnEnd; id++) inRange.add(id)
    const existing = startLabels.get(segment.turnStart) ?? []
    if (!existing.includes(label)) existing.push(label)
    startLabels.set(segment.turnStart, existing)
  }
  return { inRange, startLabels }
})

/**
 * Conversation mechanics, computed server-side by `computeTranscriptMetrics`
 * so the dashboard and the stored row can never disagree. Independent of the
 * judge, so this block is populated even on unscored calls — which is exactly
 * when the page would otherwise be bare.
 */
const metrics = computed(() => call.value?.metrics ?? null)

/** Turn ids the metrics pass flagged, for the transcript gutter. */
const flaggedTurns = computed(() => ({
  interrupted: new Set(metrics.value?.endpointing?.interruptedTurnIds ?? []),
  repeated: new Set(metrics.value?.comprehension.repeatPairs.map((p) => p.repeatedTurnId) ?? []),
  askedToRepeat: new Set(metrics.value?.comprehension.agentRepeatRequestTurnIds ?? []),
  unanswered: new Set(metrics.value?.comprehension.unansweredCallerTurnIds ?? []),
  unclear: new Set(metrics.value?.unclearTurnIds ?? []),
}))

/**
 * The model's read of the call. Unlike `metrics` this cannot be recomputed on
 * read — it costs a model call — so the panel simply hides when it is absent.
 */
const quality = computed(() => call.value?.quality ?? null)

function criterionValue(value: number | string | null) {
  if (value === null) return ''
  return typeof value === 'number' ? `${value}/5` : value
}

/**
 * Headline numbers as data rather than near-identical blocks of markup. Some
 * are counted from the transcript and some come from the model; they sit
 * together because the reader does not care which pass produced them.
 */
const summaryTiles = computed(() => {
  const c = call.value
  if (!c) return []
  const m = metrics.value
  const q = quality.value
  return [
    { label: 'Duration', value: duration(c.durationSec), tone: '' },
    { label: 'Turns', value: String(m?.turns.total ?? '—'), tone: '' },
    {
      label: 'Agent talk share',
      value: m?.talkRatio == null ? '—' : `${Math.round(m.talkRatio * 100)}%`,
      tone: '',
    },
    // A dash rather than a zero when endpointing is unavailable: on an
    // unpunctuated transcript we cannot tell a cut-off from a full stop, and
    // "0 interruptions" would read as a clean call.
    {
      label: 'Interrupted',
      value: m?.endpointing ? String(m.endpointing.interruptedTurnIds.length) : '—',
      tone: m?.endpointing?.interruptedTurnIds.length ? 'text-serious' : '',
    },
    {
      label: 'Script adherence',
      value: q ? `${q.scriptAdherence.score}/5` : '—',
      tone: q && q.scriptAdherence.score <= 2 ? 'text-serious' : '',
    },
    {
      label: 'Premature hangup',
      value: q ? (q.prematureHangup ? 'Yes' : 'No') : '—',
      tone: q?.prematureHangup ? 'text-serious' : '',
    },
    {
      label: 'Call completion',
      value: q ? (q.callCompleted ? 'Yes' : 'No') : '—',
      tone: q ? (q.callCompleted ? 'text-good' : 'text-serious') : '',
    },
    {
      label: 'Caller sentiment',
      value: q ? q.callerSentiment : '—',
      tone: q?.callerSentiment === 'negative' ? 'text-serious' : '',
    },
  ]
})

function shortInsight(insight: string) {
  return insight.split(/\s+/).filter(Boolean).slice(0, 5).join(' ')
}

</script>

<template>
  <div class="space-y-4">
    <LoadingBlock v-if="isLoading" />
    <template v-else-if="call">
      <div>
        <div class="min-w-0 space-y-2">
          <RouterLink
            :to="callsBackTarget"
            class="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink-2 hover:bg-plane hover:text-ink"
          >
            <ArrowLeft class="size-4" aria-hidden="true" />
            Back
          </RouterLink>

          <div class="min-w-0">
            <h1 class="truncate text-2xl font-semibold leading-tight">
              <!-- Web/test calls carry no number, so "Unknown caller" would read
                   as missing data rather than the normal case that it is. -->
              {{ call.contactName ?? call.contactPhone ?? 'Web call' }}
            </h1>
            <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3">
              <span>{{ dateTime(call.startedAt) }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ call.agentName }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ call.direction }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ duration(call.durationSec) }}</span>
              <span aria-hidden="true">·</span>
              <span>{{ call.outcome }}</span>
            </p>
          </div>

          <div v-if="call.isMock" class="flex flex-wrap items-center gap-2">
            <span
              class="rounded-full border border-hairline px-2 py-0.5 text-sm font-medium tracking-wide text-ink-3 uppercase"
            >
              Demo
            </span>
          </div>
        </div>
      </div>

      <div
        v-if="call.ingestStatus === 'pending'"
        class="flex items-start gap-3 rounded-lg border border-series/30 bg-series/5 px-4 py-3 text-sm"
        role="status"
        aria-live="polite"
      >
        <LoaderCircle class="mt-0.5 size-4 shrink-0 animate-spin text-series" aria-hidden="true" />
        <div>
          <p class="font-medium">This call is still being processed</p>
          <p class="mt-0.5 text-ink-2">
            Transcript metrics are available now. Quality analysis, scorecard results, and review flags will appear automatically.
          </p>
        </div>
      </div>

      <div
        v-else-if="call.ingestStatus === 'failed'"
        class="flex items-start gap-3 rounded-lg border border-critical/30 bg-critical/5 px-4 py-3 text-sm"
        role="alert"
      >
        <AlertTriangle class="mt-0.5 size-4 shrink-0 text-critical" aria-hidden="true" />
        <div>
          <p class="font-medium text-critical">Call analysis failed</p>
          <p class="mt-0.5 text-ink-2">{{ call.ingestError ?? 'The call could not be analyzed.' }}</p>
        </div>
      </div>

      <div
        v-else-if="call.ingestStatus === 'skipped'"
        class="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
        role="status"
      >
        <AlertTriangle class="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <p class="font-medium">Some analysis is unavailable</p>
          <p class="mt-0.5 text-ink-2">
            {{ call.ingestError === 'no active scorecard'
              ? 'This call predates always-on monitoring and will be analyzed automatically.'
              : call.ingestError ?? 'The transcript did not contain enough information to analyze.' }}
          </p>
        </div>
      </div>

      <!--
        Separate cards rather than one divided grid: each of these answers a
        different question, and boxing them together implied a relationship
        between neighbours that does not exist.
      -->
      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div
          v-for="tile in summaryTiles"
          :key="tile.label"
          class="flex min-h-24 flex-col justify-center rounded-lg border border-hairline bg-surface px-5 py-3"
        >
          <dt class="text-sm text-ink-3">{{ tile.label }}</dt>
          <dd class="mt-0.5 text-2xl font-semibold tabular-nums capitalize" :class="tile.tone">
            {{ tile.value }}
          </dd>
        </div>
      </dl>

      <p v-if="call.evaluation" class="rounded-lg border border-hairline bg-surface px-4 py-3 text-base text-ink-2">
        {{ call.evaluation.summary }}
      </p>

      <!--
        Same gap-3 + full width as the metric tiles above so the two columns
        bisect on the same center line as the 4-up card grid.
      -->
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
        <!--
          Laid out as a chat: caller right, agent left, one bubble per turn.
          flush + padding inside the scroller: Card body padding below a
          max-height viewport read as empty space under a clipped last turn.
        -->
        <Card title="Transcript" class="min-w-0" flush>
          <div class="max-h-[34rem] overflow-y-auto px-4 py-4">
            <EmptyState v-if="call.transcript.length === 0" title="No transcript on this call" />
            <ol v-else class="space-y-3">
              <li
                v-for="turn in call.transcript"
                :id="`turn-${turn.id}`"
                :key="turn.id"
                class="flex flex-col"
                :class="turn.role === 'caller' ? 'items-end' : 'items-start'"
              >
                <div
                  class="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm transition-colors"
                  :class="[
                    turn.role === 'caller'
                      ? 'rounded-br-sm bg-series text-white'
                      : turn.role === 'agent'
                        ? 'rounded-bl-sm bg-plane text-ink'
                        : 'bg-transparent text-ink-3 italic',
                    highlighted.has(turn.id)
                      ? 'ring-2 ring-series ring-offset-2 ring-offset-surface'
                      : useActions.inRange.has(turn.id)
                        ? 'ring-2 ring-warning ring-offset-2 ring-offset-surface'
                        : '',
                  ]"
                >
                  {{ turn.text }}
                </div>

                <div
                  class="mt-1 flex flex-wrap items-center gap-x-2 px-1 text-sm text-ink-3"
                  :class="turn.role === 'caller' ? 'justify-end' : ''"
                >
                  <span>{{ turn.role === 'agent' ? 'Agent' : turn.role === 'caller' ? 'Caller' : 'System' }}</span>
                  <span v-if="turnStamp(turn.startMs)" class="tabular-nums">{{ turnStamp(turn.startMs) }}</span>
                </div>

                <div
                  v-if="useActions.startLabels.has(turn.id)"
                  class="mt-1.5 flex flex-wrap gap-1.5 px-1"
                  :class="turn.role === 'caller' ? 'justify-end' : ''"
                >
                  <span
                    v-for="label in useActions.startLabels.get(turn.id)"
                    :key="label"
                    class="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-sm font-medium text-ink"
                  >
                    <AlertTriangle class="size-3.5 shrink-0 text-warning" aria-hidden="true" />
                    {{ label }}
                  </span>
                </div>

                <!--
                  Mechanics flags sit under the turn they describe so the number
                  in the summary strip above is always traceable to a moment in
                  the call, rather than being a statistic with no evidence.
                -->
                <div
                  v-if="
                    flaggedTurns.interrupted.has(turn.id) ||
                    flaggedTurns.repeated.has(turn.id) ||
                    flaggedTurns.askedToRepeat.has(turn.id) ||
                    flaggedTurns.unanswered.has(turn.id) ||
                    flaggedTurns.unclear.has(turn.id)
                  "
                  class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 text-sm text-ink-2"
                  :class="turn.role === 'caller' ? 'justify-end' : ''"
                >
                  <span v-if="flaggedTurns.interrupted.has(turn.id)">Cut off — agent spoke next</span>
                  <span v-if="flaggedTurns.repeated.has(turn.id)">Caller repeated an earlier point</span>
                  <span v-if="flaggedTurns.askedToRepeat.has(turn.id)">Agent asked the caller to repeat</span>
                  <span v-if="flaggedTurns.unanswered.has(turn.id)">Caller checking if anyone is there</span>
                  <span v-if="flaggedTurns.unclear.has(turn.id)">Transcriber could not make this out</span>
                </div>
              </li>
            </ol>
          </div>
        </Card>

        <div class="min-w-0 space-y-3 lg:sticky lg:top-4">
          <Card
            v-if="call.evaluation?.criteria.length"
            title="Checks"
          >
            <ul class="divide-y divide-hairline text-sm">
              <li
                v-for="criterion in call.evaluation.criteria"
                :key="criterion.key"
                class="py-2 first:pt-0 last:pb-0"
              >
                <button
                  class="flex w-full items-center justify-between gap-3 text-left disabled:cursor-default"
                  :disabled="criterion.evidenceTurnIds.length === 0"
                  @click="focusTurns(criterion.evidenceTurnIds)"
                >
                  <span class="min-w-0 truncate font-medium">{{ criterion.label }}</span>
                  <span class="flex shrink-0 items-center gap-2">
                    <span v-if="criterion.value !== null" class="text-ink-3">
                      {{ criterionValue(criterion.value) }}
                    </span>
                    <span
                      class="rounded-full border px-2 py-0.5 font-medium"
                      :class="criterion.met
                        ? 'border-good/30 bg-good/10 text-good-text'
                        : 'border-critical/30 bg-critical/5 text-critical'"
                    >
                      {{ criterion.met ? 'Passed' : 'Failed' }}
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          </Card>

          <Card v-if="quality?.insights.length" title="Insights">
            <ul class="list-disc space-y-2 pl-4 text-sm text-ink-2">
              <li v-for="(insight, i) in quality.insights" :key="i">
                {{ shortInsight(insight) }}
              </li>
            </ul>
          </Card>

          <Card v-if="quality?.scriptAdherence.missedSteps.length" title="Script gaps">
            <ul class="list-disc space-y-2 pl-4 text-sm text-ink-2">
              <li v-for="step in quality.scriptAdherence.missedSteps.slice(0, 3)" :key="step">
                {{ step }}
              </li>
            </ul>
          </Card>

          <Card v-if="quality?.missedOpportunities.length" title="Opportunities">
            <ul class="list-disc space-y-2 pl-4 text-sm text-ink-2">
              <li v-for="missed in quality.missedOpportunities.slice(0, 2)" :key="missed.action">
                <button
                  class="text-left hover:underline disabled:hover:no-underline"
                  :disabled="missed.evidenceTurnIds.length === 0"
                  @click="focusTurns(missed.evidenceTurnIds)"
                >
                  {{ missed.action }}
                </button>
              </li>
            </ul>
          </Card>

          <Card
            v-if="call.evaluation && call.evaluation.segments.length"
            title="Use actions"
          >
            <ul class="space-y-2.5">
              <li v-for="segment in call.evaluation.segments" :key="segment.id" class="text-sm">
                <div class="flex items-start justify-between gap-2">
                  <button class="text-left hover:underline" @click="focusSegment(segment)">
                    <span class="font-medium">{{ SEGMENT_ACTION_LABELS[segment.actionType] ?? segment.actionType }}</span>
                    <span class="block text-sm text-ink-2">{{ segment.reason }}</span>
                    <span class="text-sm text-ink-3">turns {{ segment.turnStart }}–{{ segment.turnEnd }}</span>
                  </button>
                  <div class="flex shrink-0 gap-1">
                    <button
                      v-if="segment.status === 'open'"
                      class="rounded-md border border-hairline px-2 py-0.5 text-sm hover:bg-plane"
                      @click="updateAction.mutate({ id: segment.id, status: 'done' })"
                    >
                      Resolve
                    </button>
                    <button
                      v-if="segment.status === 'open'"
                      class="rounded-md border border-hairline px-2 py-0.5 text-sm text-ink-3 hover:bg-plane"
                      @click="updateAction.mutate({ id: segment.id, status: 'dismissed' })"
                    >
                      Dismiss
                    </button>
                    <button
                      v-else
                      class="rounded-md border border-hairline px-2 py-0.5 text-sm text-ink-3 hover:bg-plane"
                      @click="updateAction.mutate({ id: segment.id, status: 'open' })"
                    >
                      Reopen
                    </button>
                  </div>
                </div>
              </li>
            </ul>
          </Card>

          <Card v-if="!call.evaluation?.criteria.length" title="Checks">
            <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span class="text-ink-2">No checks for {{ call.agentName }}.</span>
              <RouterLink
                :to="{ name: 'agent-settings', query: { agentId: call.agentId } }"
                class="font-medium text-series hover:underline"
              >
                Add checks
              </RouterLink>
            </div>
          </Card>
        </div>
      </div>
    </template>
  </div>
</template>
