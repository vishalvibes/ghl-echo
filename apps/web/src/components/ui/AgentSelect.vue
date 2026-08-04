<script setup lang="ts">
import { computed } from 'vue'
import { useAgentList } from '../../composables/queries.js'
import Select from './Select.vue'

/**
 * Agent scope picker. Empty string means "all agents" — the same convention
 * the API uses, where an absent `agentId` leaves the query unscoped.
 */
const model = defineModel<string>({ required: true })

const { data } = useAgentList()

const options = computed(() => [
  { value: '', label: 'All agents' },
  ...(data.value?.agents.map((agent) => ({ value: agent.id, label: agent.name })) ?? []),
])
</script>

<template>
  <Select v-model="model" :options="options" aria-label="Agent" />
</template>
