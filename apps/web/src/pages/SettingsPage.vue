<script setup lang="ts">
import { useHealth } from '../composables/queries.js'
import Card from '../components/ui/Card.vue'
import LoadingBlock from '../components/ui/LoadingBlock.vue'

const { data: health, isLoading } = useHealth()

const stateStyles: Record<string, string> = {
  ok: 'bg-good/10 text-good-text border-good/30',
  degraded: 'bg-warning/10 text-ink border-warning/40',
  down: 'bg-critical/10 text-critical border-critical/30',
  disabled: 'border-hairline text-ink-3',
}

const componentLabels: Record<string, string> = {
  api: 'API server',
  database: 'Postgres',
  queue: 'Inngest queue',
  llm: 'Judge model',
  ghl: 'HighLevel connection',
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-lg font-semibold">Settings</h1>

    <Card title="System health" subtitle="Live status of every component in the observability pipeline">
      <LoadingBlock v-if="isLoading" />
      <ul v-else-if="health" class="space-y-2">
        <li
          v-for="(component, key) in health.components"
          :key="key"
          class="flex items-center justify-between rounded-md border border-hairline px-3 py-2 text-sm"
        >
          <span class="font-medium">{{ componentLabels[key] ?? key }}</span>
          <span class="flex items-center gap-2">
            <span v-if="component.detail" class="text-xs text-ink-3">{{ component.detail }}</span>
            <span class="rounded-full border px-2 py-0.5 text-xs font-medium" :class="stateStyles[component.state]">
              {{ component.state }}
            </span>
          </span>
        </li>
      </ul>
    </Card>

    <Card title="Data sources" subtitle="What is live vs mocked in this installation">
      <ul class="space-y-1.5 text-sm text-ink-2">
        <li v-if="health?.fixtureMode" class="flex items-center gap-2">
          <span class="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium">demo data</span>
          Seeded fixture calls and evaluations are active (USE_FIXTURES=true). They are flagged
          <code class="rounded bg-plane px-1 text-xs">is_mock</code> in the database.
        </li>
        <li>Webhook ingest: <code class="rounded bg-plane px-1 text-xs">POST /webhooks/ghl</code> — live when the marketplace app is installed.</li>
        <li>Backfill: triggered automatically after install, replays historical call logs through the same pipeline.</li>
        <li>Prompt patches are copy-to-clipboard — the app never writes to your agents.</li>
      </ul>
    </Card>
  </div>
</template>
