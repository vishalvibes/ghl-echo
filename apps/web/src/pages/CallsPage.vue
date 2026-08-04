<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCalls, type CallFilters } from '../composables/queries.js'
import { dateTime, duration } from '../lib/format.js'
import Card from '../components/ui/Card.vue'
import AgentSelect from '../components/ui/AgentSelect.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'

const agentId = ref('')
const page = ref(1)

// Reset paging when a filter changes — page 3 of a different set is
// meaningless.
watch(agentId, () => (page.value = 1))

const filters = computed<CallFilters>(() => ({
  window: '30d',
  agentId: agentId.value || undefined,
  page: page.value,
}))

const { data, isLoading } = useCalls(filters)

const router = useRouter()
function open(id: string) {
  void router.push(`/calls/${id}`)
}

const totalPages = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))
const hasActiveFilters = computed(() => Boolean(agentId.value))

function channelLabel(channel: 'web' | 'phone') {
  return channel === 'web' ? 'Web call' : 'Phone call'
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-semibold">Calls</h1>
      <AgentSelect v-model="agentId" />
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
                <th class="px-4 py-2.5 font-medium">When</th>
                <th class="px-4 py-2.5 font-medium">Channel</th>
                <th class="px-4 py-2.5 font-medium">Agent</th>
                <th class="px-4 py-2.5 font-medium">Duration</th>
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
                <td class="px-4 py-3 whitespace-nowrap">{{ dateTime(call.startedAt) }}</td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <span>{{ channelLabel(call.channel) }}</span>
                    <span
                      v-if="call.isTestCall"
                      class="rounded-full border border-hairline bg-plane px-2 py-0.5 text-sm font-medium text-ink-2"
                    >
                      Test call
                    </span>
                  </div>
                </td>
                <td class="px-4 py-3 text-ink-2">{{ call.agentName }}</td>
                <td class="px-4 py-3 tabular-nums">{{ duration(call.durationSec) }}</td>
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
