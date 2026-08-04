<script setup lang="ts" generic="T extends string | number">
/**
 * Text/number input on the same shadcn control scale as `Select` — h-9, px-3,
 * text-sm. Callers add width utilities (`w-52`, `flex-1`) via the usual class
 * fallthrough; they must not restate height, padding or font size, or the
 * controls stop lining up with each other again.
 *
 * `type="number"` is coerced here rather than by a `v-model.number` modifier —
 * built-in modifiers apply to native elements, not components, so a caller
 * writing `v-model.number` on this would silently store the raw string and
 * fail validation on save.
 */
const props = withDefaults(defineProps<{ type?: string }>(), { type: 'text' })
const model = defineModel<T>({ required: true })

function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  model.value = (props.type === 'number' && raw !== '' ? Number(raw) : raw) as T
}
</script>

<template>
  <input
    :type="type"
    :value="model"
    class="h-9 rounded-md border border-hairline bg-surface px-3 text-sm text-ink"
    @input="onInput"
  />
</template>
