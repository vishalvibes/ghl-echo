<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { SEGMENT_ACTION_LABELS } from '@copilot/shared'
import { useActions, useUpdateAction } from '../composables/queries.js'
import { dateTime } from '../lib/format.js'
import Card from '../components/ui/Card.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'

const status = ref<'open' | 'done' | 'dismissed'>('open')
const typeFilter = ref('')

const { data, isLoading } = useActions(status)
const updateAction = useUpdateAction()

const items = computed(() =>
  (data.value?.items ?? []).filter((item) => !typeFilter.value || item.actionType === typeFilter.value),
)

const severityClass: Record<string, string> = {
  high: 'text-critical',
  medium: 'text-serious',
  low: 'text-ink-2',
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-lg font-semibold">Action queue</h1>
      <div class="flex items-center gap-2">
        <select v-model="typeFilter" class="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm" aria-label="Action type">
          <option value="">All types</option>
          <option v-for="(label, key) in SEGMENT_ACTION_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
        <div class="flex rounded-md border border-hairline bg-surface p-0.5 text-sm" role="tablist">
          <button
            v-for="option in (['open', 'done', 'dismissed'] as const)"
            :key="option"
            class="rounded px-2.5 py-1 capitalize"
            :class="status === option ? 'bg-plane font-medium' : 'text-ink-2'"
            role="tab"
            :aria-selected="status === option"
            @click="status = option"
          >
            {{ option }}
          </button>
        </div>
      </div>
    </div>

    <Card>
      <LoadingBlock v-if="isLoading" />
      <EmptyState
        v-else-if="items.length === 0"
        title="Queue clear"
        detail="No call segments need attention with these filters."
      />
      <ul v-else class="divide-y divide-hairline">
        <li v-for="item in items" :key="item.id" class="flex items-start justify-between gap-3 py-3">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 text-sm font-medium">
              <span :class="severityClass[item.severity]" aria-hidden="true">●</span>
              {{ SEGMENT_ACTION_LABELS[item.actionType] ?? item.actionType }}
              <span class="text-[10px] uppercase text-ink-3">{{ item.severity }}</span>
            </div>
            <p class="mt-0.5 truncate text-xs text-ink-2">{{ item.reason }}</p>
            <p class="mt-0.5 text-xs text-ink-3">
              {{ item.agentName }} · {{ item.contactPhone ?? 'unknown number' }} · {{ dateTime(item.startedAt) }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <RouterLink
              :to="`/calls/${item.callId}`"
              class="rounded-md border border-hairline px-2.5 py-1 text-xs hover:bg-plane"
            >
              Open call
            </RouterLink>
            <template v-if="item.status === 'open'">
              <button
                class="rounded-md border border-hairline px-2.5 py-1 text-xs hover:bg-plane"
                @click="updateAction.mutate({ id: item.id, status: 'done' })"
              >
                Done
              </button>
              <button
                class="rounded-md border border-hairline px-2.5 py-1 text-xs text-ink-3 hover:bg-plane"
                @click="updateAction.mutate({ id: item.id, status: 'dismissed' })"
              >
                Dismiss
              </button>
            </template>
            <button
              v-else
              class="rounded-md border border-hairline px-2.5 py-1 text-xs text-ink-3 hover:bg-plane"
              @click="updateAction.mutate({ id: item.id, status: 'open' })"
            >
              Reopen
            </button>
          </div>
        </li>
      </ul>
    </Card>
  </div>
</template>
