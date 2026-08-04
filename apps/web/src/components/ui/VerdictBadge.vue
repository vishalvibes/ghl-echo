<script setup lang="ts">
import type { Verdict } from '@copilot/shared'

defineProps<{ verdict: Verdict | null }>()

// Status colors are paired with a text label — color never carries the
// meaning alone.
const styles: Record<Verdict, string> = {
  pass: 'bg-good/10 text-good-text border-good/30',
  partial: 'bg-warning/10 text-ink border-warning/40',
  fail: 'bg-critical/10 text-critical border-critical/30',
}
const labels: Record<Verdict, string> = { pass: 'Pass', partial: 'Partial', fail: 'Fail' }
</script>

<template>
  <span
    v-if="verdict"
    class="inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-medium"
    :class="styles[verdict]"
  >
    {{ labels[verdict] }}
  </span>
  <span v-else class="inline-flex items-center rounded-full border border-hairline px-2 py-0.5 text-sm text-ink-3">
    Not scored
  </span>
</template>
