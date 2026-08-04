<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCalls, type CallFilters } from '../composables/queries.js'
import { dateTime, duration } from '../lib/format.js'
import Card from '../components/ui/Card.vue'
import VerdictBadge from '../components/ui/VerdictBadge.vue'
import AgentSelect from '../components/ui/AgentSelect.vue'
import Select from '../components/ui/Select.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'

type VerdictFilter = '' | 'pass' | 'partial' | 'fail'

const verdictFilters: { value: VerdictFilter; label: string }[] = [
  { value: '', label: 'Any verdict' },
  { value: 'fail', label: 'Failed' },
  { value: 'partial', label: 'Partial' },
  { value: 'pass', label: 'Passed' },
]

const verdict = ref<VerdictFilter>('')
const agentId = ref('')
const page = ref(1)

// Reset paging when a filter changes — page 3 of a different set is
// meaningless.
watch([verdict, agentId], () => (page.value = 1))

const filters = computed<CallFilters>(() => ({
  window: '30d',
  verdict: verdict.value || undefined,
  agentId: agentId.value || undefined,
  page: page.value,
}))

const { data, isLoading } = useCalls(filters)

const router = useRouter()
function open(id: string) {
  void router.push(`/calls/${id}`)
}

const totalPages = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))
const hasActiveFilters = computed(() => Boolean(agentId.value || verdict.value))
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-semibold">Calls</h1>
      <!--
        Agent is the primary filter: it is the question people actually arrive
        with, and it is answerable on every call. Verdict is secondary and
        deliberately quieter — most calls are unscored (no scorecard yet, judge
        disabled, too short to judge), so leading with it would present an
        empty-looking list as the default view of a working account.
      -->
      <div class="flex flex-wrap items-center gap-2">
        <AgentSelect v-model="agentId" />
        <Select v-model="verdict" :options="verdictFilters" aria-label="Filter by verdict" />
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
              <!--
                Verdict sits after the call's own facts rather than first:
                unscored is the common case, and a leading column of "Not
                scored" makes a healthy account look broken.
              -->
              <tr class="border-b border-hairline text-left text-sm text-ink-3">
                <th class="px-4 py-2.5 font-medium">When</th>
                <th class="px-4 py-2.5 font-medium">Contact</th>
                <th class="px-4 py-2.5 font-medium">Agent</th>
                <th class="px-4 py-2.5 font-medium">Duration</th>
                <th class="px-4 py-2.5 font-medium">Verdict</th>
                <th class="px-4 py-2.5 font-medium">Score</th>
                <th class="px-4 py-2.5 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              <!--
                The row is the click target, not just the timestamp — a 7-column
                row with one small link is a needlessly precise thing to hit.
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
                <td class="px-4 py-3 whitespace-nowrap">{{ dateTime(call.startedAt) }}</td>
                <td class="px-4 py-3">
                  <div>{{ call.contactName ?? call.contactPhone ?? 'Web call' }}</div>
                  <div v-if="call.contactName && call.contactPhone" class="text-sm text-ink-3">
                    {{ call.contactPhone }}
                  </div>
                </td>
                <td class="px-4 py-3 text-ink-2">{{ call.agentName }}</td>
                <td class="px-4 py-3 tabular-nums">{{ duration(call.durationSec) }}</td>
                <td class="px-4 py-3"><VerdictBadge :verdict="call.verdict" /></td>
                <td class="px-4 py-3 tabular-nums">{{ call.overallScore ?? '—' }}</td>
                <td class="px-4 py-3 text-sm text-ink-2">
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
