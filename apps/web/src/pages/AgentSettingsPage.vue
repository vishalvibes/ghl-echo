<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Pause, Play, Settings2 } from 'lucide-vue-next'
import {
  useAgentList,
  useSetMonitoring,
  type AgentListItem,
} from '../composables/queries.js'
import AgentSetupDialog from '../components/agent-settings/AgentSetupDialog.vue'
import Card from '../components/ui/Card.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'

const route = useRoute()
const router = useRouter()
const { data: agentList, isLoading } = useAgentList()
const setMonitoring = useSetMonitoring()

const selectedAgentId = ref('')
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
onBeforeUnmount(() => {
  if (toastTimer) clearTimeout(toastTimer)
})

const selectedAgent = computed(() =>
  agentList.value?.agents.find((agent) => agent.id === selectedAgentId.value) ?? null,
)

watch(
  [() => route.query.agentId, agentList],
  ([queryAgentId, list]) => {
    const requested = typeof queryAgentId === 'string' ? queryAgentId : ''
    if (requested && list?.agents.some((agent) => agent.id === requested)) {
      selectedAgentId.value = requested
    }
  },
  { immediate: true },
)

function openSetup(agentId: string) {
  selectedAgentId.value = agentId
  void router.replace({ name: 'agent-settings', query: { agentId } })
}

function closeSetup() {
  selectedAgentId.value = ''
  void router.replace({ name: 'agent-settings' })
}

function showToast(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 4_000)
}

function handleSaved(message: string) {
  closeSetup()
  showToast(message)
}

async function toggleMonitoring(agent: AgentListItem) {
  const state = agent.monitoringState === 'monitoring' ? 'paused' : 'monitoring'
  try {
    await setMonitoring.mutateAsync({ agentId: agent.id, state })
    showToast(state === 'paused' ? `${agent.name} paused` : `${agent.name} resumed`)
  } catch {
    showToast(`Could not ${state === 'paused' ? 'pause' : 'resume'} ${agent.name}`)
  }
}

function statusLabel(agent: AgentListItem) {
  if (agent.processingCalls > 0) return `Evaluating ${agent.processingCalls} calls…`
  if (agent.monitoringState === 'monitoring') return 'Monitoring'
  if (agent.monitoringState === 'paused') return 'Paused'
  return 'Not set up'
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-semibold">Agent settings</h1>

    <LoadingBlock v-if="isLoading" />
    <Card v-else flush>
      <EmptyState v-if="!agentList?.agents.length" title="No agents found" />
      <div v-else class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-sm">
          <thead class="text-ink-3">
            <tr class="border-b border-hairline">
              <th class="px-4 py-2.5 font-medium">Agent</th>
              <th class="px-4 py-2.5 font-medium">Modality</th>
              <th class="px-4 py-2.5 font-medium">Observability</th>
              <th class="px-4 py-2.5 font-medium">Criteria</th>
              <th class="px-4 py-2.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="agent in agentList.agents" :key="agent.id" class="border-b border-hairline last:border-0">
              <td class="px-4 py-3 font-medium">{{ agent.name }}</td>
              <td class="px-4 py-3 text-ink-2">Voice</td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex rounded-full border px-2 py-0.5 text-sm font-medium"
                  :class="agent.processingCalls > 0
                    ? 'border-warning/40 bg-warning/10 text-ink'
                    : agent.monitoringState === 'monitoring'
                      ? 'border-good/30 bg-good/10 text-good-text'
                      : 'border-hairline bg-plane text-ink-2'"
                >
                  {{ statusLabel(agent) }}
                </span>
              </td>
              <td class="px-4 py-3 text-ink-2">
                {{ agent.configured ? `${agent.criteriaCount} active · v${agent.scorecardVersion}` : '—' }}
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-2">
                  <button
                    class="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-3 py-1.5 font-medium hover:bg-plane"
                    @click="openSetup(agent.id)"
                  >
                    <Settings2 class="size-3.5" aria-hidden="true" />
                    {{ agent.configured ? 'Edit settings' : 'Set up' }}
                  </button>
                  <button
                    v-if="agent.configured"
                    class="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-3 py-1.5 font-medium hover:bg-plane disabled:opacity-50"
                    :disabled="setMonitoring.isPending.value"
                    @click="toggleMonitoring(agent)"
                  >
                    <Pause v-if="agent.monitoringState === 'monitoring'" class="size-3.5" aria-hidden="true" />
                    <Play v-else class="size-3.5" aria-hidden="true" />
                    {{ agent.monitoringState === 'monitoring' ? 'Pause' : 'Resume' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>

    <AgentSetupDialog
      v-if="selectedAgent"
      :agent="selectedAgent"
      @close="closeSetup"
      @saved="handleSaved"
    />

    <Teleport to="body">
      <div
        v-if="toast"
        role="status"
        class="fixed right-5 bottom-5 z-[60] rounded-lg bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg"
      >
        {{ toast }}
      </div>
    </Teleport>
  </div>
</template>
