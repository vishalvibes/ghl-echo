<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ExternalLink, LayoutDashboard, Phone, Settings2 } from 'lucide-vue-next'
import echoLogo from '../assets/echo-logo.png'
import { useIntegrationStatus } from '../composables/queries.js'
import LoadingBlock from './ui/LoadingBlock.vue'

const route = useRoute()
const { data: integration, isLoading, isError } = useIntegrationStatus()
const voiceAiAgentsUrl = computed(() =>
  integration.value
    ? `https://app.gohighlevel.com/v2/location/${encodeURIComponent(integration.value.ghlLocationId)}/ai-agents/voice-ai`
    : '#',
)

const nav = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, match: (p: string) => p === '/' || p.startsWith('/agents') },
  { to: '/calls', label: 'Calls', icon: Phone, match: (p: string) => p.startsWith('/calls') },
  { to: '/settings', label: 'Agent settings', icon: Settings2, match: (p: string) => p.startsWith('/settings') },
]
</script>

<template>
  <!--
    Horizontal tabs rather than a sidebar: the app renders inside a HighLevel
    iframe that already owns a left nav, so a second vertical rail reads as a
    competing app. Tabs sit where GHL puts its own sub-navigation.

    Tabs lead and the wordmark trails on the same baseline. Inside someone
    else's chrome the navigation is what the user came for; our branding is the
    footnote, and stacking it above cost a whole row of height to say so.
  -->
  <div class="flex h-full flex-col">
    <header v-if="integration?.oauthConnected" class="shrink-0 border-b border-hairline bg-surface">
      <div
        class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6"
      >
        <nav class="-mb-px" aria-label="Main">
          <div class="flex items-center gap-1 overflow-x-auto">
            <RouterLink
              v-for="item in nav"
              :key="item.to"
              :to="item.to"
              class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-5 text-sm whitespace-nowrap"
              :class="
                item.match(route.path)
                  ? 'border-series font-medium text-ink'
                  : 'border-transparent text-ink-2 hover:text-ink'
              "
              :aria-current="item.match(route.path) ? 'page' : undefined"
            >
              <component :is="item.icon" class="size-4" aria-hidden="true" />
              {{ item.label }}
            </RouterLink>
          </div>
        </nav>

        <div class="flex shrink-0 items-center gap-2.5">
          <img :src="echoLogo" alt="Echo" class="h-8 w-auto" />
          <span class="hidden truncate text-sm text-ink-3 sm:inline">Agent observability</span>
        </div>
      </div>
    </header>

    <main class="min-w-0 flex-1 overflow-y-auto bg-plane">
      <div class="mx-auto max-w-6xl px-6 pt-3 pb-32">
        <LoadingBlock v-if="isLoading" />

        <div v-else-if="isError" class="flex min-h-[50vh] flex-col items-center justify-center text-center">
          <img :src="echoLogo" alt="Echo" class="mb-5 h-9 w-auto" />
          <p class="text-sm font-medium text-ink-2">Could not check HighLevel authorization</p>
          <p class="mt-1 text-sm text-ink-3">Refresh the page and try again.</p>
        </div>

        <div
          v-else-if="integration && !integration.oauthConnected"
          class="flex min-h-[50vh] flex-col items-center justify-center text-center"
        >
          <img :src="echoLogo" alt="Echo" class="mb-5 h-9 w-auto" />
          <p class="text-sm font-medium text-ink-2">HighLevel authorization required</p>
          <p class="mt-1 max-w-lg text-sm text-ink-3">
            Echo does not have an OAuth token for this sub-account.
            Reinstall or reauthorize Echo from the HighLevel Marketplace, then return here.
          </p>
        </div>

        <div
          v-else-if="integration && !integration.hasCalls && route.name !== 'agent-settings'"
          class="flex min-h-[50vh] flex-col items-center justify-center text-center"
        >
          <img :src="echoLogo" alt="Echo" class="mb-5 h-9 w-auto" />
          <p class="text-sm font-medium text-ink-2">Start using your Voice AI agents</p>
          <p class="mt-1 text-sm text-ink-3">Call analytics will appear after your agents handle conversations.</p>
          <a
            :href="voiceAiAgentsUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-4 inline-flex items-center gap-2 rounded-md bg-series px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Open Voice AI agents
            <ExternalLink class="size-4" aria-hidden="true" />
          </a>
        </div>

        <slot v-else />
      </div>
    </main>
  </div>
</template>
