<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Pencil, Plus, Trash2, X } from 'lucide-vue-next'
import type { Criterion, ScorecardDraft } from '@copilot/shared'
import {
  useSaveScorecard,
  useScorecard,
  type AgentListItem,
} from '../../composables/queries.js'
import EmptyState from '../ui/EmptyState.vue'
import Input from '../ui/Input.vue'
import LoadingBlock from '../ui/LoadingBlock.vue'

const props = defineProps<{ agent: AgentListItem }>()
const emit = defineEmits<{
  close: []
  saved: [message: string]
}>()

const agentId = computed(() => props.agent.id)
const { data, isLoading, isError, refetch } = useScorecard(agentId)
const save = useSaveScorecard(agentId)

const criteria = ref<Criterion[]>([])
const passThreshold = ref(70)
const partialThreshold = ref(40)
const dirty = ref(false)
const expandedCriterionKey = ref<string | null>(null)

watch(
  data,
  (value) => {
    if (!value || dirty.value) return
    // Vue Query exposes cached data through reactive proxies, which cannot be
    // passed to structuredClone in the browser. Copy each flat criterion into
    // editable local state instead so the query update can finish rendering.
    criteria.value = (value.scorecard?.criteria ?? []).map((criterion) => ({ ...criterion }))
    passThreshold.value = value.scorecard?.passThreshold ?? 70
    partialThreshold.value = value.scorecard?.partialThreshold ?? 40
    expandedCriterionKey.value = null
  },
  { immediate: true },
)

const validationError = computed(() => {
  if (criteria.value.length === 0) return null
  const keys = criteria.value.map((criterion) => criterion.key)
  if (new Set(keys).size !== keys.length) return 'Criterion keys must be unique.'
  if (criteria.value.some((criterion) => criterion.label.trim().length === 0)) return 'Name every criterion.'
  if (criteria.value.some((criterion) => criterion.definition.trim().length === 0)) {
    return 'Add a pass condition for every criterion.'
  }
  if (partialThreshold.value >= passThreshold.value) return 'The fail threshold must be below the pass threshold.'
  return null
})

const reviewRange = computed(() => `${partialThreshold.value}–${Math.max(partialThreshold.value, passThreshold.value - 1)}`)

function addCriterion() {
  let index = criteria.value.length + 1
  let key = `criterion_${index}`
  while (criteria.value.some((criterion) => criterion.key === key)) {
    index += 1
    key = `criterion_${index}`
  }
  criteria.value.push({
    key,
    label: 'New criterion',
    type: 'boolean',
    weight: 1,
    definition: '',
    failWhen: null,
    enabled: true,
  })
  expandedCriterionKey.value = key
  markDirty()
}

function removeCriterion(index: number) {
  if (criteria.value[index]?.key === expandedCriterionKey.value) expandedCriterionKey.value = null
  criteria.value.splice(index, 1)
  markDirty()
}

function toggleCriterion(key: string) {
  expandedCriterionKey.value = expandedCriterionKey.value === key ? null : key
}

function markDirty() {
  dirty.value = true
}

function draft(): ScorecardDraft {
  return {
    passThreshold: passThreshold.value,
    partialThreshold: partialThreshold.value,
    criteria: criteria.value,
  }
}

async function submit() {
  if (criteria.value.length === 0 || validationError.value) return
  try {
    const result = await save.mutateAsync(draft())
    dirty.value = false
    const queued = result.queuedCalls ?? 0
    emit('saved', queued > 0 ? `Settings saved · evaluating ${queued} calls` : 'Settings saved')
  } catch {
    // The mutation error is rendered in the footer so the draft stays intact.
  }
}

function requestClose() {
  if (dirty.value && !window.confirm('Discard unsaved changes?')) return
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
      @click.self="requestClose"
      @keydown.esc="requestClose"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-settings-title"
        class="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-2xl"
      >
        <header class="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-5 py-4">
          <h2 id="agent-settings-title" class="text-lg font-semibold">
            {{ agent.configured ? 'Edit criteria for' : 'Add criteria for' }} {{ agent.name }}
          </h2>
          <button class="rounded-md p-1 text-ink-3 hover:bg-plane hover:text-ink" aria-label="Close" @click="requestClose">
            <X class="size-5" aria-hidden="true" />
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-5">
          <LoadingBlock v-if="isLoading" />
          <div v-else-if="isError" class="rounded-lg border border-critical/30 bg-critical/5 p-4">
            <p class="font-medium text-critical">Could not load these settings.</p>
            <p class="mt-1 text-sm text-ink-3">Check your connection and try again.</p>
            <button
              class="mt-3 rounded-md border border-hairline bg-surface px-3 py-2 text-sm font-medium hover:bg-plane"
              @click="refetch()"
            >
              Try again
            </button>
          </div>
          <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">Criteria</h3>
              <button
                class="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1.5 text-sm hover:bg-plane"
                @click="addCriterion"
              >
                <Plus class="size-3.5" aria-hidden="true" /> Add criterion
              </button>
            </div>

            <EmptyState
              v-if="criteria.length === 0"
              class="mt-3 rounded-lg border border-dashed border-hairline"
              title="No criteria yet"
            >
              <button
                class="mt-3 inline-flex items-center gap-1.5 rounded-md bg-series px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                @click="addCriterion"
              >
                <Plus class="size-3.5" aria-hidden="true" /> Add first criterion
              </button>
            </EmptyState>

            <ul v-else class="mt-4 space-y-3">
              <li v-for="(criterion, index) in criteria" :key="criterion.key" class="rounded-lg border border-hairline p-3">
                <div class="flex items-center gap-3">
                  <span class="shrink-0 text-sm font-medium text-ink-3">{{ index + 1 }}</span>
                  <div class="min-w-0 flex-1">
                    <Input
                      v-if="expandedCriterionKey === criterion.key"
                      v-model="criterion.label"
                      class="w-full font-medium"
                      aria-label="Criterion name"
                      placeholder="Criterion name"
                      @input="markDirty"
                    />
                    <p v-else class="truncate font-medium">{{ criterion.label }}</p>
                  </div>
                  <button
                    class="rounded p-1.5 text-ink-3 hover:bg-plane hover:text-ink"
                    :aria-label="`${expandedCriterionKey === criterion.key ? 'Collapse' : 'Edit'} ${criterion.label}`"
                    @click="toggleCriterion(criterion.key)"
                  >
                    <Pencil class="size-4" aria-hidden="true" />
                  </button>
                  <button class="rounded p-1.5 text-ink-3 hover:bg-plane hover:text-critical" :aria-label="`Delete ${criterion.label}`" @click="removeCriterion(index)">
                    <Trash2 class="size-4" aria-hidden="true" />
                  </button>
                </div>

                <div v-if="expandedCriterionKey === criterion.key" class="mt-3 grid gap-3 sm:grid-cols-2">
                  <label class="block">
                    <span class="text-sm font-medium text-good-text">Pass when</span>
                    <textarea
                      v-model="criterion.definition"
                      rows="3"
                      placeholder="The agent confirms a date and time."
                      class="mt-1 w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm"
                      @input="markDirty"
                    />
                  </label>
                  <label class="block">
                    <span class="text-sm font-medium text-critical">Fail when <span class="font-normal text-ink-3">(optional)</span></span>
                    <textarea
                      :value="criterion.failWhen ?? ''"
                      rows="3"
                      placeholder="The call ends without a confirmed slot."
                      class="mt-1 w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm"
                      @input="criterion.failWhen = ($event.target as HTMLTextAreaElement).value || null; markDirty()"
                    />
                  </label>
                </div>
              </li>
            </ul>

            <section v-if="criteria.length > 0" class="mt-5 border-t border-hairline pt-4">
              <div class="flex items-baseline justify-between gap-3">
                <h3 class="text-sm font-semibold">Verdict thresholds</h3>
                <span class="text-sm text-ink-3">Average score</span>
              </div>

              <div class="mt-3 grid grid-cols-3 divide-x divide-hairline rounded-lg border border-hairline bg-plane/40">
                <label class="min-w-0 px-3 py-2.5">
                  <span class="block text-sm text-ink-3">Pass</span>
                  <div class="mt-1 flex items-center gap-1.5">
                    <input
                      v-model.number="passThreshold"
                      type="number"
                      min="1"
                      max="100"
                      class="w-16 rounded border border-hairline bg-surface px-2 py-1 text-sm tabular-nums"
                      @input="markDirty"
                    />
                    <span class="text-sm text-ink-3">+</span>
                  </div>
                </label>
                <div class="min-w-0 px-3 py-2.5">
                  <span class="block text-sm text-ink-3">Needs review</span>
                  <p class="mt-2 text-sm tabular-nums text-ink-2">{{ reviewRange }}</p>
                </div>
                <label class="min-w-0 px-3 py-2.5">
                  <span class="block text-sm text-ink-3">Fail below</span>
                  <input
                    v-model.number="partialThreshold"
                    type="number"
                    min="0"
                    max="99"
                    class="mt-1 w-16 rounded border border-hairline bg-surface px-2 py-1 text-sm tabular-nums"
                    @input="markDirty"
                  />
                </label>
              </div>
            </section>
          </template>
        </div>

        <footer class="flex shrink-0 items-center justify-between gap-3 border-t border-hairline px-5 py-4">
          <p class="text-sm" :class="save.isError.value || (dirty && validationError) ? 'text-critical' : 'text-ink-3'">
            {{ save.isError.value ? 'Could not save settings. Try again.' : dirty ? (validationError ?? 'Unsaved changes') : '' }}
          </p>
          <div class="flex items-center gap-2">
            <button class="rounded-md border border-hairline px-3 py-2 text-sm font-medium hover:bg-plane" @click="requestClose">
              Cancel
            </button>
            <button
              class="rounded-md bg-series px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              :disabled="criteria.length === 0 || !!validationError || (!dirty && agent.configured) || save.isPending.value"
              @click="submit"
            >
              {{ save.isPending.value ? 'Saving…' : 'Save criteria' }}
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
