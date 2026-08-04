<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Flag } from 'lucide-vue-next'
import type { AnalyticsWindow } from '@copilot/shared'
import { useCalls, type CallFilters } from '../composables/queries.js'
import { dateTime, duration } from '../lib/format.js'
import Card from '../components/ui/Card.vue'
import AgentSelect from '../components/ui/AgentSelect.vue'
import Input from '../components/ui/Input.vue'
import Select from '../components/ui/Select.vue'
import VerdictBadge from '../components/ui/VerdictBadge.vue'
import WindowSelect from '../components/ui/WindowSelect.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'

const agentId = ref('')
const window = ref<AnalyticsWindow>('30d')
const verdict = ref<'' | 'pass' | 'partial' | 'fail'>('')
const route = useRoute()
const flaggedOnly = ref(route.query.flagged === 'true')
const search = ref('')
const page = ref(1)

const verdictOptions: Array<{ value: '' | 'pass' | 'partial' | 'fail'; label: string }> = [
  { value: '', label: 'Any verdict' },
  { value: 'pass', label: 'Pass' },
  { value: 'partial', label: 'Needs review' },
  { value: 'fail', label: 'Fail' },
]

watch([window, agentId, verdict, flaggedOnly], () => (page.value = 1))

const router = useRouter()
watch(flaggedOnly, (value) => {
  const query = { ...route.query }
  if (value) query.flagged = 'true'
  else delete query.flagged
  void router.replace({ query })
})

const debouncedSearch = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    debouncedSearch.value = value
    page.value = 1
  }, 300)
})

const filters = computed<CallFilters>(() => ({
  window: window.value,
  agentId: agentId.value || undefined,
  verdict: verdict.value || undefined,
  needsAction: flaggedOnly.value || undefined,
  search: debouncedSearch.value || undefined,
  page: page.value,
}))

const { data, isLoading } = useCalls(filters)

function open(id: string) {
  void router.push({
    path: `/calls/${id}`,
    query: flaggedOnly.value ? { from: 'flagged' } : {},
  })
}

const totalPages = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))
const hasActiveFilters = computed(() =>
  Boolean(agentId.value || verdict.value || flaggedOnly.value || debouncedSearch.value),
)

function channelLabel(channel: 'web' | 'phone') {
  return channel === 'web' ? 'Web call' : 'Phone call'
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-semibold">Calls</h1>
      <div class="flex flex-wrap items-center gap-2">
        <Input v-model="search" type="search" class="w-64" placeholder="Search transcript, name, phone…" aria-label="Search calls" />
        <AgentSelect v-model="agentId" />
        <Select v-model="verdict" :options="verdictOptions" aria-label="Verdict" />
        <label class="flex h-9 items-center gap-2 rounded-md border border-hairline bg-surface px-3 text-sm text-ink-2">
          <input v-model="flaggedOnly" type="checkbox" class="rounded border-hairline" />
          Flagged only
        </label>
        <WindowSelect v-model="window" />
      </div>
    </div>

    <Card flush>
      <div v-if="isLoading" class="p-4"><LoadingBlock /></div>
      <div v-else-if="!data || data.items.length === 0" class="p-4">
        <EmptyState :title="hasActiveFilters ? 'No calls match these filters' : 'No calls available yet'" />
      </div>
      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-hairline text-left text-sm text-ink-3">
                <th class="px-4 py-2.5 font-medium">Verdict</th>
                <th class="px-4 py-2.5 font-medium">When</th>
                <th class="px-4 py-2.5 font-medium">Contact</th>
                <th class="px-4 py-2.5 font-medium">Direction</th>
                <th class="px-4 py-2.5 font-medium">Agent</th>
                <th class="px-4 py-2.5 font-medium">Duration</th>
                <th class="px-4 py-2.5 font-medium">Score</th>
                <th class="px-4 py-2.5 font-medium">Review</th>
              </tr>
            </thead>
            <tbody>
              <!--
                The row is the click target, not just the timestamp.
                tabindex + Enter keeps it reachable without a mouse.
              -->
              <tr
                v-for="call in data.items"
                :key="call.id"
                class="cursor-pointer border-b border-hairline last:border-0 hover:bg-plane focus-visible:bg-plane focus-visible:outline-none"
                tabindex="0"
                @click="open(call.id)"
                @keydown.enter="open(call.id)"
              >
                <td class="px-4 py-3"><VerdictBadge :verdict="call.verdict" /></td>
                <td class="px-4 py-3 whitespace-nowrap">{{ dateTime(call.startedAt) }}</td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <span>{{ call.contactName ?? call.contactPhone ?? channelLabel(call.channel) }}</span>
                    <span v-if="call.contactName || call.contactPhone" class="text-ink-3">
                      {{ channelLabel(call.channel) }}
                    </span>
                    <span
                      v-if="call.isTestCall"
                      class="rounded-full border border-hairline bg-plane px-2 py-0.5 font-medium text-ink-2"
                    >
                      Test call
                    </span>
                  </div>
                </td>
                <td class="px-4 py-3 capitalize text-ink-2">{{ call.direction }}</td>
                <td class="px-4 py-3 text-ink-2">{{ call.agentName }}</td>
                <td class="px-4 py-3 tabular-nums">{{ duration(call.durationSec) }}</td>
                <td class="px-4 py-3 tabular-nums">{{ call.overallScore ?? '—' }}</td>
                <td class="px-4 py-3 text-ink-2">
                  <span v-if="call.findingCount">
                    {{ call.findingCount }} finding{{ call.findingCount === 1 ? '' : 's' }}
                  </span>
                  <span
                    v-if="call.actionCount"
                    class="ml-2 inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 font-medium"
                  >
                    <Flag class="size-3.5" aria-hidden="true" />
                    {{ call.actionCount }} flag{{ call.actionCount === 1 ? '' : 's' }}
                  </span>
                  <span v-if="!call.findingCount && !call.actionCount" class="text-ink-3">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex items-center justify-between border-t border-hairline px-4 py-3 text-sm text-ink-2">
          <span>{{ data.total }} calls</span>
          <div class="flex items-center gap-2">
            <button
              class="rounded-md border border-hairline px-2 py-1 disabled:opacity-40"
              :disabled="page <= 1"
              @click="page--"
            >
              Prev
            </button>
            <span>Page {{ page }} / {{ totalPages }}</span>
            <button
              class="rounded-md border border-hairline px-2 py-1 disabled:opacity-40"
              :disabled="page >= totalPages"
              @click="page++"
            >
              Next
            </button>
          </div>
        </div>
      </template>
    </Card>
  </div>
</template>
