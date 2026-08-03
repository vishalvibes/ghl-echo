<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { AnalyticsWindow } from '@copilot/shared'
import { useAgentList, useCalls, type CallFilters } from '../composables/queries.js'
import { dateTime, duration } from '../lib/format.js'
import Card from '../components/ui/Card.vue'
import VerdictBadge from '../components/ui/VerdictBadge.vue'
import WindowSelect from '../components/ui/WindowSelect.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'

const window = ref<AnalyticsWindow>('7d')
const agentId = ref<string>('')
const verdict = ref<'' | 'pass' | 'partial' | 'fail'>('')
const needsAction = ref(false)
const search = ref('')
const page = ref(1)

// Reset paging whenever a filter changes — page 3 of a different filter set
// is meaningless.
watch([window, agentId, verdict, needsAction, search], () => (page.value = 1))

const debouncedSearch = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
watch(search, (value) => {
  clearTimeout(timer)
  timer = setTimeout(() => (debouncedSearch.value = value), 300)
})

const filters = computed<CallFilters>(() => ({
  window: window.value,
  agentId: agentId.value || undefined,
  verdict: verdict.value || undefined,
  needsAction: needsAction.value || undefined,
  search: debouncedSearch.value || undefined,
  page: page.value,
}))

const { data, isLoading } = useCalls(filters)
const { data: agents } = useAgentList()

const totalPages = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-lg font-semibold">Calls</h1>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-model="search"
          type="search"
          placeholder="Search transcript, name, phone…"
          class="w-56 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm"
          aria-label="Search calls"
        />
        <select v-model="agentId" class="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm" aria-label="Agent">
          <option value="">All agents</option>
          <option v-for="agent in agents?.agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
        </select>
        <select v-model="verdict" class="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm" aria-label="Verdict">
          <option value="">Any verdict</option>
          <option value="pass">Pass</option>
          <option value="partial">Partial</option>
          <option value="fail">Fail</option>
        </select>
        <label class="flex items-center gap-1.5 text-sm text-ink-2">
          <input v-model="needsAction" type="checkbox" class="rounded border-hairline" />
          Needs action
        </label>
        <WindowSelect v-model="window" />
      </div>
    </div>

    <Card>
      <LoadingBlock v-if="isLoading" />
      <EmptyState v-else-if="!data || data.items.length === 0" title="No calls match these filters" />
      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-hairline text-left text-xs text-ink-3">
                <th class="py-2 pr-4 font-medium">Verdict</th>
                <th class="py-2 pr-4 font-medium">When</th>
                <th class="py-2 pr-4 font-medium">Contact</th>
                <th class="py-2 pr-4 font-medium">Agent</th>
                <th class="py-2 pr-4 font-medium">Duration</th>
                <th class="py-2 pr-4 font-medium">Score</th>
                <th class="py-2 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="call in data.items" :key="call.id" class="border-b border-hairline last:border-0 hover:bg-plane">
                <td class="py-2.5 pr-4"><VerdictBadge :verdict="call.verdict" /></td>
                <td class="py-2.5 pr-4 whitespace-nowrap">
                  <RouterLink :to="`/calls/${call.id}`" class="text-series hover:underline">
                    {{ dateTime(call.startedAt) }}
                  </RouterLink>
                </td>
                <td class="py-2.5 pr-4">
                  <div>{{ call.contactName ?? 'Unknown' }}</div>
                  <div class="text-xs text-ink-3">{{ call.contactPhone ?? '—' }}</div>
                </td>
                <td class="py-2.5 pr-4 text-ink-2">{{ call.agentName }}</td>
                <td class="py-2.5 pr-4 tabular-nums">{{ duration(call.durationSec) }}</td>
                <td class="py-2.5 pr-4 tabular-nums">{{ call.overallScore ?? '—' }}</td>
                <td class="py-2.5 text-xs text-ink-2">
                  <span v-if="call.findingCount">{{ call.findingCount }} finding{{ call.findingCount > 1 ? 's' : '' }}</span>
                  <span v-if="call.actionCount" class="ml-2 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-medium">
                    ⚠ {{ call.actionCount }}
                  </span>
                  <span v-if="!call.findingCount && !call.actionCount" class="text-ink-3">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mt-3 flex items-center justify-between text-xs text-ink-2">
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
