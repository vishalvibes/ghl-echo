<script setup lang="ts">
defineProps<{ title: string; detail?: string }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-1 py-10 text-center">
    <p class="text-sm font-medium text-ink-2">{{ title }}</p>
    <p v-if="detail" class="max-w-sm text-sm text-ink-3">{{ detail }}</p>
    <slot />
  </div>
</template>
