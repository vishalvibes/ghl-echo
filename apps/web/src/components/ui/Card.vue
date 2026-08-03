<script setup lang="ts">
defineProps<{ title?: string; subtitle?: string }>()
</script>

<template>
  <section class="rounded-lg border border-hairline bg-surface">
    <header v-if="title" class="flex items-baseline justify-between gap-2 border-b border-hairline px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold">{{ title }}</h2>
        <p v-if="subtitle" class="text-xs text-ink-3">{{ subtitle }}</p>
      </div>
      <slot name="actions" />
    </header>
    <div class="p-4">
      <slot />
    </div>
  </section>
</template>
