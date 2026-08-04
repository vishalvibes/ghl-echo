<script setup lang="ts">
/**
 * `flush` drops the body padding so full-bleed content — tables whose rows
 * need to span the whole card for hover and click targets — can own its own
 * spacing per cell.
 */
withDefaults(defineProps<{
  title?: string
  subtitle?: string
  flush?: boolean
  headerDivider?: boolean
}>(), {
  headerDivider: true,
})
</script>

<template>
  <section class="rounded-lg border border-hairline bg-surface">
    <header
      v-if="title"
      :class="[
        'flex items-baseline justify-between gap-2 px-4',
        headerDivider ? 'border-b border-hairline py-3' : 'pt-4',
      ]"
    >
      <div>
        <h2 class="text-sm font-semibold">{{ title }}</h2>
        <p v-if="subtitle" class="text-sm text-ink-3">{{ subtitle }}</p>
      </div>
      <slot name="actions" />
    </header>
    <div :class="flush ? '' : 'p-4'">
      <slot />
    </div>
  </section>
</template>
