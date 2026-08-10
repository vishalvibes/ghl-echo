<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus, Trash2, X } from 'lucide-vue-next'
import type { AgentListItem } from '../../composables/queries.js'
import {
  useAgentTestCases,
  useConfirmEdgeCases,
  useProposeEdgeCases,
  useRunTestCases,
  useSaveAgentGoals,
  useSaveAgentPrompt,
  useSuggestTestPrompt,
} from '../../composables/queries.js'
import EmptyState from '../ui/EmptyState.vue'
import Input from '../ui/Input.vue'
import LoadingBlock from '../ui/LoadingBlock.vue'

const props = defineProps<{ agent: AgentListItem }>()
const emit = defineEmits<{
  close: []
  done: [message: string]
}>()

const agentId = computed(() => props.agent.id)
const { data, isLoading, isError, refetch } = useAgentTestCases(agentId)
const saveGoals = useSaveAgentGoals(agentId)
const propose = useProposeEdgeCases(agentId)
const confirm = useConfirmEdgeCases(agentId)
const run = useRunTestCases(agentId)
const suggestPrompt = useSuggestTestPrompt(agentId)
const savePrompt = useSaveAgentPrompt(agentId)

type Step = 'goals' | 'edges' | 'tests'
const step = ref<Step>('goals')
const skippedToTests = ref(false)

const goals = ref<string[]>([])
const goalsDirty = ref(false)
const edgeCases = ref<string[]>([])
const expandedId = ref<string | null>(null)
const expandedMockIndex = ref<number | null>(null)
const actionError = ref('')
const promptSuggestion = ref<{
  currentPrompt: string
  revisedPrompt: string
  summary: string
} | null>(null)

watch(
  data,
  (value) => {
    if (!value) return
    if (!goalsDirty.value) goals.value = [...value.goals]
    // Existing packs skip goals/edge generation.
    if (!skippedToTests.value && value.testCases.length > 0) {
      skippedToTests.value = true
      step.value = 'tests'
      expandedId.value = value.testCases[0]?.id ?? null
    }
  },
  { immediate: true },
)

const testCases = computed(() => data.value?.testCases ?? [])
const hasScoredResults = computed(() => testCases.value.some((t) => (t.results?.length ?? 0) > 0))
const busy = computed(
  () =>
    saveGoals.isPending.value ||
    propose.isPending.value ||
    confirm.isPending.value ||
    run.isPending.value ||
    suggestPrompt.isPending.value ||
    savePrompt.isPending.value,
)

const cleanedGoals = computed(() => goals.value.map((g) => g.trim()).filter(Boolean))
const cleanedEdges = computed(() => edgeCases.value.map((e) => e.trim()).filter(Boolean))

type DiffLine = { kind: 'same' | 'add' | 'del'; text: string }

function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! })
      i += 1
      j += 1
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: 'del', text: a[i]! })
      i += 1
    } else {
      out.push({ kind: 'add', text: b[j]! })
      j += 1
    }
  }
  while (i < n) {
    out.push({ kind: 'del', text: a[i]! })
    i += 1
  }
  while (j < m) {
    out.push({ kind: 'add', text: b[j]! })
    j += 1
  }
  return out
}

const promptDiffLines = computed(() => {
  if (!promptSuggestion.value) return []
  return lineDiff(promptSuggestion.value.currentPrompt, promptSuggestion.value.revisedPrompt)
})

function markGoalsDirty() {
  goalsDirty.value = true
  actionError.value = ''
}

function addGoal() {
  goals.value.push('')
  markGoalsDirty()
}

function removeGoal(index: number) {
  goals.value.splice(index, 1)
  markGoalsDirty()
}

function addEdgeCase() {
  edgeCases.value.push('')
  actionError.value = ''
}

function removeEdgeCase(index: number) {
  edgeCases.value.splice(index, 1)
}

async function continueFromGoals() {
  actionError.value = ''
  if (cleanedGoals.value.length === 0) {
    actionError.value = 'Add at least one goal to continue.'
    return
  }
  try {
    await saveGoals.mutateAsync(cleanedGoals.value)
    goals.value = [...cleanedGoals.value]
    goalsDirty.value = false
    step.value = 'edges'
  } catch {
    actionError.value = 'Could not save goals.'
  }
}

async function generateEdgeCases() {
  actionError.value = ''
  if (cleanedGoals.value.length === 0) {
    actionError.value = 'Add at least one goal first.'
    return
  }
  try {
    if (goalsDirty.value) {
      await saveGoals.mutateAsync(cleanedGoals.value)
      goals.value = [...cleanedGoals.value]
      goalsDirty.value = false
    }
    const result = await propose.mutateAsync(cleanedGoals.value)
    edgeCases.value = [...result.edgeCases]
  } catch (error) {
    actionError.value =
      (error as { status?: number }).status === 503
        ? 'LLM is disabled.'
        : 'Could not propose edge cases.'
  }
}

async function generateTestCases() {
  actionError.value = ''
  if (cleanedEdges.value.length === 0) {
    actionError.value = 'Add or generate at least one edge case.'
    return
  }
  try {
    await confirm.mutateAsync(cleanedEdges.value)
    promptSuggestion.value = null
    step.value = 'tests'
    emit('done', `Created ${cleanedEdges.value.length} test cases`)
  } catch (error) {
    actionError.value =
      (error as { status?: number }).status === 503
        ? 'LLM is disabled.'
        : 'Could not generate test cases.'
  }
}

async function runTests() {
  actionError.value = ''
  promptSuggestion.value = null
  try {
    await run.mutateAsync()
    const first = testCases.value[0]
    if (first) expandedId.value = first.id
  } catch (error) {
    actionError.value =
      (error as { status?: number }).status === 503
        ? 'LLM is disabled.'
        : 'Could not run test cases.'
  }
}

async function suggestPromptChanges() {
  actionError.value = ''
  try {
    promptSuggestion.value = await suggestPrompt.mutateAsync()
  } catch (error) {
    const status = (error as { status?: number }).status
    actionError.value =
      status === 503
        ? 'LLM is disabled.'
        : status === 409
          ? 'Run tests with failures first, then suggest changes.'
          : 'Could not suggest prompt changes.'
  }
}

async function applyPromptSuggestion() {
  if (!promptSuggestion.value) return
  if (!window.confirm('Replace the agent prompt with the suggested revision?')) return
  actionError.value = ''
  try {
    await savePrompt.mutateAsync(promptSuggestion.value.revisedPrompt)
    emit('done', 'Prompt updated — re-run tests to verify')
  } catch {
    actionError.value = 'Could not apply prompt.'
  }
}

function toggleExpanded(id: string) {
  if (expandedId.value === id) {
    expandedId.value = null
    expandedMockIndex.value = null
  } else {
    expandedId.value = id
    expandedMockIndex.value = null
  }
}

function criterionMet(testCaseId: string, criterionKey: string, transcriptIndex: number): boolean | null {
  const row = testCases.value.find((t) => t.id === testCaseId)
  const result = row?.results?.find((r) => r.transcriptIndex === transcriptIndex)
  const hit = result?.criteria.find((c) => c.key === criterionKey)
  return hit ? hit.met : null
}

function mockFeedback(testCaseId: string, transcriptIndex: number): string | null {
  const row = testCases.value.find((t) => t.id === testCaseId)
  return row?.results?.find((r) => r.transcriptIndex === transcriptIndex)?.feedback ?? null
}

function requestClose() {
  if (busy.value) return
  if (
    (step.value === 'goals' && goalsDirty.value) ||
    (step.value === 'edges' && edgeCases.value.length > 0 && testCases.value.length === 0)
  ) {
    if (!window.confirm('Discard progress and close?')) return
  }
  emit('close')
}

function goBack() {
  actionError.value = ''
  if (step.value === 'edges') step.value = 'goals'
  else if (step.value === 'tests') {
    // From skipped landing, Back goes to goals so users can regenerate.
    step.value = testCases.value.length > 0 ? 'goals' : 'edges'
  }
}

function startFreshGeneration() {
  promptSuggestion.value = null
  step.value = 'goals'
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
        aria-labelledby="agent-testing-title"
        class="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-2xl"
      >
        <header class="flex shrink-0 items-center justify-between gap-4 border-b border-hairline px-5 py-4">
          <div>
            <h2 id="agent-testing-title" class="text-lg font-semibold">
              Generate tests for {{ agent.name }}
            </h2>
            <p class="mt-0.5 text-sm text-ink-3">
              <span :class="step === 'goals' ? 'text-ink font-medium' : ''">1. Goals</span>
              <span class="mx-1.5 text-ink-3">·</span>
              <span :class="step === 'edges' ? 'text-ink font-medium' : ''">2. Edge cases</span>
              <span class="mx-1.5 text-ink-3">·</span>
              <span :class="step === 'tests' ? 'text-ink font-medium' : ''">3. Test cases</span>
            </p>
          </div>
          <button class="rounded-md p-1 text-ink-3 hover:bg-plane hover:text-ink" aria-label="Close" @click="requestClose">
            <X class="size-5" aria-hidden="true" />
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-5">
          <LoadingBlock v-if="isLoading" />
          <div v-else-if="isError" class="rounded-lg border border-critical/30 bg-critical/5 p-4">
            <p class="font-medium text-critical">Could not load testing data.</p>
            <button
              class="mt-3 rounded-md border border-hairline bg-surface px-3 py-2 text-sm font-medium hover:bg-plane"
              @click="refetch()"
            >
              Try again
            </button>
          </div>

          <template v-else-if="step === 'goals'">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">Goals</h3>
              <button
                class="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1.5 text-sm hover:bg-plane"
                :disabled="busy"
                @click="addGoal"
              >
                <Plus class="size-3.5" aria-hidden="true" /> Add goal
              </button>
            </div>
            <p class="mt-1 text-sm text-ink-3">
              What should this agent achieve? Edge cases will be derived from these goals.
            </p>

            <EmptyState
              v-if="goals.length === 0"
              class="mt-3 rounded-lg border border-dashed border-hairline"
              title="No goals yet"
            >
              <button
                class="mt-3 inline-flex items-center gap-1.5 rounded-md bg-series px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                @click="addGoal"
              >
                <Plus class="size-3.5" aria-hidden="true" /> Add first goal
              </button>
            </EmptyState>

            <ul v-else class="mt-4 space-y-2">
              <li v-for="(goal, index) in goals" :key="index" class="flex items-center gap-2">
                <Input
                  :model-value="goal"
                  class="w-full"
                  :placeholder="`Goal ${index + 1}`"
                  @update:model-value="goals[index] = String($event); markGoalsDirty()"
                />
                <button
                  class="rounded p-1.5 text-ink-3 hover:bg-plane hover:text-critical"
                  :aria-label="`Delete goal ${index + 1}`"
                  @click="removeGoal(index)"
                >
                  <Trash2 class="size-4" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </template>

          <template v-else-if="step === 'edges'">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">Edge cases</h3>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1.5 text-sm hover:bg-plane disabled:opacity-50"
                  :disabled="busy"
                  @click="addEdgeCase"
                >
                  <Plus class="size-3.5" aria-hidden="true" /> Add edge case
                </button>
                <button
                  class="rounded-md border border-hairline px-2.5 py-1.5 text-sm font-medium hover:bg-plane disabled:opacity-50"
                  :disabled="busy || cleanedGoals.length === 0"
                  @click="generateEdgeCases"
                >
                  {{ propose.isPending.value ? 'Generating…' : 'Generate edge cases' }}
                </button>
              </div>
            </div>
            <p class="mt-1 text-sm text-ink-3">
              One-line failure conditions to test. Generate from goals, or write your own.
            </p>

            <EmptyState
              v-if="edgeCases.length === 0"
              class="mt-3 rounded-lg border border-dashed border-hairline"
              title="No edge cases yet"
            >
              <p class="mt-1 text-sm text-ink-3">Generate from goals or add one manually.</p>
            </EmptyState>

            <ul v-else class="mt-4 space-y-2">
              <li v-for="(edge, index) in edgeCases" :key="index" class="flex items-center gap-2">
                <Input
                  :model-value="edge"
                  class="w-full"
                  :placeholder="`Edge case ${index + 1}`"
                  @update:model-value="edgeCases[index] = String($event)"
                />
                <button
                  class="rounded p-1.5 text-ink-3 hover:bg-plane hover:text-critical"
                  :aria-label="`Delete edge case ${index + 1}`"
                  @click="removeEdgeCase(index)"
                >
                  <Trash2 class="size-4" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </template>

          <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">Test cases</h3>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  v-if="testCases.length > 0"
                  class="rounded-md border border-hairline px-3 py-2 text-sm font-medium hover:bg-plane disabled:opacity-50"
                  :disabled="busy"
                  @click="startFreshGeneration"
                >
                  Regenerate
                </button>
                <button
                  class="rounded-md bg-series px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  :disabled="testCases.length === 0 || busy"
                  @click="runTests"
                >
                  {{ run.isPending.value ? 'Running…' : 'Run tests' }}
                </button>
                <button
                  class="rounded-md border border-hairline px-3 py-2 text-sm font-medium hover:bg-plane disabled:opacity-50"
                  :disabled="!hasScoredResults || busy"
                  @click="suggestPromptChanges"
                >
                  {{ suggestPrompt.isPending.value ? 'Suggesting…' : 'Suggest prompt changes' }}
                </button>
              </div>
            </div>
            <p class="mt-1 text-sm text-ink-3">
              Run scores each mock call against criteria. Suggest prompt changes after you have failures.
            </p>

            <section
              v-if="promptSuggestion"
              class="mt-4 space-y-3 rounded-lg border border-hairline p-3"
            >
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 class="text-sm font-semibold">Suggested prompt</h4>
                  <p class="mt-1 text-sm text-ink-2">{{ promptSuggestion.summary }}</p>
                </div>
                <button
                  class="rounded-md bg-series px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  :disabled="busy"
                  @click="applyPromptSuggestion"
                >
                  {{ savePrompt.isPending.value ? 'Applying…' : 'Apply' }}
                </button>
              </div>
              <div class="max-h-64 overflow-auto rounded-md border border-hairline bg-plane/30 p-2 font-mono text-sm">
                <div
                  v-for="(line, index) in promptDiffLines"
                  :key="index"
                  class="whitespace-pre-wrap break-words"
                  :class="{
                    'bg-good/10 text-good-text': line.kind === 'add',
                    'bg-critical/10 text-critical': line.kind === 'del',
                    'text-ink-2': line.kind === 'same',
                  }"
                >
                  <span class="select-none text-ink-3">{{ line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ' }}</span>
                  {{ line.text }}
                </div>
              </div>
            </section>

            <EmptyState
              v-if="testCases.length === 0"
              class="mt-3 rounded-lg border border-dashed border-hairline"
              title="No test cases yet"
            />

            <ul v-else class="mt-4 space-y-3">
              <li
                v-for="testCase in testCases"
                :key="testCase.id"
                class="rounded-lg border border-hairline p-3"
              >
                <div class="flex items-start gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="font-medium">{{ testCase.edgeCase }}</p>
                    <p class="mt-1 text-sm text-ink-3">
                      {{ testCase.criteria.length }} criteria · {{ testCase.transcripts.length }} mock calls
                      <span v-if="testCase.results"> · scored</span>
                    </p>
                  </div>
                  <button
                    class="shrink-0 rounded-md border border-hairline px-2 py-1 text-sm hover:bg-plane"
                    @click="toggleExpanded(testCase.id)"
                  >
                    {{ expandedId === testCase.id ? 'Hide' : 'Details' }}
                  </button>
                </div>

                <div v-if="expandedId === testCase.id" class="mt-3 space-y-4 border-t border-hairline pt-3">
                  <div>
                    <p class="text-sm font-medium">
                      {{ testCase.results?.length ? 'Criteria scores' : 'Criteria' }}
                    </p>
                    <div class="mt-2 overflow-x-auto rounded-md border border-hairline">
                      <table class="w-full border-collapse text-left text-sm">
                        <thead class="bg-plane/40 text-ink-3">
                          <tr class="border-b border-hairline">
                            <th class="px-3 py-2 font-medium">Criterion</th>
                            <th class="px-3 py-2 font-medium">Description</th>
                            <template v-if="testCase.results?.length">
                              <th
                                v-for="(_, tIndex) in testCase.transcripts"
                                :key="tIndex"
                                class="px-3 py-2 text-center font-medium"
                              >
                                Mock {{ tIndex + 1 }}
                              </th>
                            </template>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="criterion in testCase.criteria"
                            :key="criterion.key"
                            class="border-b border-hairline last:border-0"
                          >
                            <td class="px-3 py-2 font-medium align-top">{{ criterion.label }}</td>
                            <td class="px-3 py-2 text-ink-2 align-top">{{ criterion.description }}</td>
                            <template v-if="testCase.results?.length">
                              <td
                                v-for="(_, tIndex) in testCase.transcripts"
                                :key="tIndex"
                                class="px-3 py-2 text-center align-top"
                              >
                                <span
                                  v-if="criterionMet(testCase.id, criterion.key, tIndex) === true"
                                  class="text-good-text"
                                >Pass</span>
                                <span
                                  v-else-if="criterionMet(testCase.id, criterion.key, tIndex) === false"
                                  class="text-critical"
                                >Fail</span>
                                <span v-else class="text-ink-3">—</span>
                              </td>
                            </template>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <ul v-if="testCase.results?.length" class="mt-2 space-y-1 text-sm text-ink-2">
                      <li v-for="(_, tIndex) in testCase.transcripts" :key="tIndex">
                        <template v-if="mockFeedback(testCase.id, tIndex)">
                          <span class="font-medium">Mock {{ tIndex + 1 }}:</span>
                          {{ mockFeedback(testCase.id, tIndex) }}
                        </template>
                      </li>
                    </ul>
                  </div>

                  <div>
                    <p class="text-sm font-medium">Scenario</p>
                    <ol class="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-2">
                      <li v-for="(stepLine, index) in testCase.scenario" :key="index">{{ stepLine }}</li>
                    </ol>
                  </div>

                  <div>
                    <p class="text-sm font-medium">Mock calls</p>
                    <ul class="mt-2 space-y-2">
                      <li
                        v-for="(transcript, tIndex) in testCase.transcripts"
                        :key="tIndex"
                        class="rounded-md border border-hairline"
                      >
                        <button
                          class="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-plane"
                          @click="expandedMockIndex = expandedMockIndex === tIndex ? null : tIndex"
                        >
                          <span>Mock {{ tIndex + 1 }} · {{ transcript.length }} turns</span>
                          <span class="text-ink-3">{{ expandedMockIndex === tIndex ? 'Hide' : 'Show' }}</span>
                        </button>
                        <ul
                          v-if="expandedMockIndex === tIndex"
                          class="space-y-1 border-t border-hairline px-3 py-2 text-sm"
                        >
                          <li v-for="turn in transcript" :key="turn.id" class="text-ink-2">
                            <span class="font-medium text-ink">{{ turn.role }}:</span>
                            {{ turn.text }}
                          </li>
                        </ul>
                      </li>
                    </ul>
                  </div>
                </div>
              </li>
            </ul>
          </template>

          <p v-if="actionError" class="mt-4 text-sm text-critical">{{ actionError }}</p>
        </div>

        <footer class="flex shrink-0 items-center justify-between gap-3 border-t border-hairline px-5 py-4">
          <button
            v-if="step !== 'goals'"
            class="rounded-md border border-hairline px-3 py-2 text-sm font-medium hover:bg-plane disabled:opacity-50"
            :disabled="busy"
            @click="goBack"
          >
            Back
          </button>
          <button
            v-else
            class="rounded-md border border-hairline px-3 py-2 text-sm font-medium hover:bg-plane"
            :disabled="busy"
            @click="requestClose"
          >
            Cancel
          </button>

          <div class="flex items-center gap-2">
            <button
              v-if="step === 'goals'"
              class="rounded-md bg-series px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              :disabled="cleanedGoals.length === 0 || busy"
              @click="continueFromGoals"
            >
              {{ saveGoals.isPending.value ? 'Saving…' : 'Continue' }}
            </button>
            <button
              v-else-if="step === 'edges'"
              class="rounded-md bg-series px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              :disabled="cleanedEdges.length === 0 || busy"
              @click="generateTestCases"
            >
              {{ confirm.isPending.value ? 'Generating…' : 'Generate test cases' }}
            </button>
            <button
              v-else
              class="rounded-md border border-hairline px-3 py-2 text-sm font-medium hover:bg-plane"
              :disabled="busy"
              @click="emit('close')"
            >
              Done
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
