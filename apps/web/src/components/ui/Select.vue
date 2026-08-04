<script setup lang="ts" generic="T extends string">
/**
 * Shadcn-style select on Reka UI.
 *
 * Same control scale as Input (h-9, px-3, text-sm, rounded-md). Callers pass
 * `options` and bind with v-model — no native <option> slots. Empty-string
 * values are remapped internally because Reka rejects "" as an item value.
 */
import { computed, useAttrs } from 'vue'
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'
import { Check, ChevronDown } from 'lucide-vue-next'
import { cn } from '../../lib/utils.js'

const EMPTY = '__empty__'

const model = defineModel<T>({ required: true })
const props = defineProps<{
  options: Array<{ value: T; label: string }>
  placeholder?: string
}>()

const attrs = useAttrs()

const internal = computed({
  get: () => (model.value === ('' as T) ? EMPTY : String(model.value)),
  set: (v: string) => {
    model.value = (v === EMPTY ? '' : v) as T
  },
})

const itemValue = (value: T) => (value === ('' as T) ? EMPTY : String(value))
</script>

<script lang="ts">
export default { inheritAttrs: false }
</script>

<template>
  <SelectRoot v-model="internal">
    <SelectTrigger
      :class="
        cn(
          'inline-flex h-9 items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-3 text-sm text-ink outline-none',
          'focus-visible:border-series focus-visible:ring-2 focus-visible:ring-series/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'data-[placeholder]:text-ink-3 [&[data-placeholder]>span]:text-ink-3',
          attrs.class as string | undefined,
        )
      "
      :aria-label="attrs['aria-label'] as string | undefined"
    >
      <SelectValue :placeholder="placeholder" class="truncate" />
      <SelectIcon as-child>
        <ChevronDown class="size-4 shrink-0 text-ink-3" aria-hidden="true" />
      </SelectIcon>
    </SelectTrigger>

    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        class="z-50 max-h-72 min-w-[var(--reka-select-trigger-width)] overflow-hidden rounded-md border border-hairline bg-surface text-ink shadow-md"
      >
        <SelectViewport class="p-1">
          <SelectItem
            v-for="option in options"
            :key="itemValue(option.value)"
            :value="itemValue(option.value)"
            class="relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-plane data-[highlighted]:text-ink"
          >
            <span class="absolute left-2 flex size-3.5 items-center justify-center">
              <SelectItemIndicator>
                <Check class="size-4" aria-hidden="true" />
              </SelectItemIndicator>
            </span>
            <SelectItemText>{{ option.label }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
