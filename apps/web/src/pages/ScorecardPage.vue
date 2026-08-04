<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Plus, Sparkles, Trash2 } from 'lucide-vue-next'
import type { Criterion } from '@copilot/shared'
import { useSaveScorecard, useScorecard, useSuggestCriteria } from '../composables/queries.js'
import Card from '../components/ui/Card.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'
import Input from '../components/ui/Input.vue'
import Select from '../components/ui/Select.vue'

const route = useRoute()
const agentId = computed(() => String(route.params.id))

const { data, isLoading } = useScorecard(agentId)
const save = useSaveScorecard(agentId)
const suggest = useSuggestCriteria(agentId)

const criteria = ref<Criterion[]>([])
const passThreshold = ref(70)
const partialThreshold = ref(40)
const dirty = ref(false)

watch(
  data,
  (value) => {
    if (value?.scorecard && !dirty.value) {
      criteria.value = structuredClone(value.scorecard.criteria)
      passThreshold.value = value.scorecard.passThreshold
      partialThreshold.value = value.scorecard.partialThreshold
    }
  },
  { immediate: true },
)

function markDirty() {
  dirty.value = true
}

const criterionTypeOptions: Array<{ value: Criterion['type']; label: string }> = [
  { value: 'boolean', label: 'boolean' },
  { value: 'scale', label: 'scale 1–5' },
  { value: 'extraction', label: 'extraction' },
]

function addCriterion() {
  criteria.value.push({
    key: `new_criterion_${criteria.value.length + 1}`,
    label: 'New criterion',
    type: 'boolean',
    weight: 1,
    definition: '',
    failWhen: null,
    enabled: true,
  })
  markDirty()
}

function removeCriterion(index: number) {
  criteria.value.splice(index, 1)
  markDirty()
}

async function generateFromPrompt() {
  const result = await suggest.mutateAsync()
  criteria.value = result.criteria
  markDirty()
}

const llmDisabled = computed(() => (suggest.error.value as { status?: number } | null)?.status === 503)

const validationError = computed(() => {
  if (criteria.value.length === 0) return 'At least one criterion is required.'
  const keys = criteria.value.map((c) => c.key)
  if (new Set(keys).size !== keys.length) return 'Criterion keys must be unique.'
  if (keys.some((key) => !/^[a-z][a-z0-9_]*$/.test(key))) return 'Keys must be lower_snake_case.'
  if (criteria.value.some((c) => c.definition.trim().length === 0)) return 'Every criterion needs a definition.'
  if (partialThreshold.value >= passThreshold.value) return 'Partial threshold must be below pass threshold.'
  return null
})

async function submit() {
  if (validationError.value) return
  await save.mutateAsync({
    passThreshold: passThreshold.value,
    partialThreshold: partialThreshold.value,
    criteria: criteria.value,
  })
  dirty.value = false
}
</script>

<template>
  <div class="space-y-4">
    <LoadingBlock v-if="isLoading" />
    <template v-else-if="data">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm text-ink-3">
            <RouterLink :to="`/agents/${agentId}`" class="hover:underline">{{ data.agentName }}</RouterLink> / Scorecard
          </div>
          <h1 class="text-lg font-semibold">
            Observability parameters
            <span v-if="data.scorecard" class="text-sm font-normal text-ink-3">v{{ data.scorecard.version }}</span>
          </h1>
        </div>
        <button
          class="flex items-center gap-1.5 rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm hover:bg-plane disabled:opacity-50"
          :disabled="suggest.isPending.value"
          @click="generateFromPrompt"
        >
          <Sparkles class="size-4 text-series" aria-hidden="true" />
          {{ suggest.isPending.value ? 'Reading agent prompt…' : 'Generate from agent prompt' }}
        </button>
      </div>

      <p v-if="llmDisabled" class="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        LLM is disabled — criteria generation needs OPENAI_ENABLED=true in apps/api/.env.
      </p>
      <p v-if="suggest.data.value" class="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink-2">
        {{ suggest.data.value.reasoning }}
      </p>

      <Card title="Criteria" subtitle="What the judge scores every call against. Saving creates a new version; existing evaluations keep theirs.">
        <template #actions>
          <button class="flex items-center gap-1 rounded-md border border-hairline px-2.5 py-1 text-sm hover:bg-plane" @click="addCriterion">
            <Plus class="size-3.5" aria-hidden="true" /> Add
          </button>
        </template>

        <EmptyState v-if="criteria.length === 0" title="No criteria yet" detail="Add one manually or generate from the agent's prompt." />
        <ul v-else class="space-y-3">
          <li v-for="(criterion, index) in criteria" :key="index" class="rounded-lg border border-hairline p-3">
            <div class="flex flex-wrap items-center gap-2">
              <input
                v-model="criterion.enabled"
                type="checkbox"
                class="rounded border-hairline"
                :aria-label="`Enable ${criterion.label}`"
                @change="markDirty"
              />
              <Input
                v-model="criterion.key"
                class="w-52 font-mono"
                aria-label="Criterion key"
                @input="markDirty"
              />
              <Input
                v-model="criterion.label"
                class="min-w-40 flex-1"
                aria-label="Criterion label"
                @input="markDirty"
              />
              <Select
                v-model="criterion.type"
                :options="criterionTypeOptions"
                aria-label="Criterion type"
                @update:model-value="markDirty"
              />
              <label class="flex items-center gap-1 text-sm text-ink-2">
                weight
                <Input
                  v-model="criterion.weight"
                  type="number"
                  min="1"
                  max="5"
                  class="w-16"
                  @input="markDirty"
                />
              </label>
              <button class="text-ink-3 hover:text-critical" :aria-label="`Delete ${criterion.label}`" @click="removeCriterion(index)">
                <Trash2 class="size-4" aria-hidden="true" />
              </button>
            </div>
            <textarea
              v-model="criterion.definition"
              rows="2"
              placeholder="What the auditor judges this criterion against — be specific and observable."
              class="mt-2 w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm"
              aria-label="Definition"
              @input="markDirty"
            />
            <input
              :value="criterion.failWhen ?? ''"
              placeholder="Fails when… (optional, sharpens borderline cases)"
              class="mt-1.5 w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm"
              aria-label="Fail condition"
              @input="criterion.failWhen = ($event.target as HTMLInputElement).value || null; markDirty()"
            />
          </li>
        </ul>
      </Card>

      <Card title="Thresholds">
        <div class="flex flex-wrap items-center gap-6 text-sm">
          <label class="flex items-center gap-2">
            Pass at
            <input
              v-model.number="passThreshold"
              type="number"
              min="0"
              max="100"
              class="w-20 rounded-md border border-hairline bg-surface px-2 py-1"
              @input="markDirty"
            />
            /100
          </label>
          <label class="flex items-center gap-2">
            Partial at
            <input
              v-model.number="partialThreshold"
              type="number"
              min="0"
              max="100"
              class="w-20 rounded-md border border-hairline bg-surface px-2 py-1"
              @input="markDirty"
            />
            /100 — below this is a hard fail
          </label>
        </div>
      </Card>

      <div class="flex items-center justify-between">
        <p class="text-sm" :class="validationError ? 'text-critical' : 'text-ink-3'">
          {{ validationError ?? (dirty ? 'Unsaved changes' : 'Saved') }}
        </p>
        <button
          class="rounded-md bg-series px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          :disabled="!!validationError || !dirty || save.isPending.value"
          @click="submit"
        >
          {{ save.isPending.value ? 'Saving…' : `Save as v${(data.scorecard?.version ?? 0) + 1}` }}
        </button>
      </div>
    </template>
  </div>
</template>
