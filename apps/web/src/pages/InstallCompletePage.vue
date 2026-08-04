<script setup lang="ts">
import { CheckCircle2 } from 'lucide-vue-next'
import echoLogo from '../assets/echo-logo.png'
</script>

<template>
  <main class="flex min-h-full items-center justify-center bg-plane px-6 py-12 text-center">
    <div class="flex max-w-md flex-col items-center">
      <img :src="echoLogo" alt="Echo" class="h-11 w-auto" />
      <CheckCircle2 class="mt-8 size-8 text-good" aria-hidden="true" />
      <h1 class="mt-4 text-xl font-semibold text-ink">Echo is connected</h1>
      <p class="mt-2 text-sm text-ink-3">
        Installation is complete. You can close this tab and return to HighLevel.
      </p>
    </div>
  </main>
</template>
