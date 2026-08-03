<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { Activity, LayoutDashboard, ListChecks, LogOut, Phone, Settings } from 'lucide-vue-next'
import { useHealth } from '../composables/queries.js'
import { logout } from '../lib/api.js'

const route = useRoute()
const router = useRouter()
const { data: health } = useHealth()

async function signOut() {
  await logout()
  await router.push('/login')
}

const nav = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, match: (p: string) => p === '/' || p.startsWith('/agents') },
  { to: '/calls', label: 'Calls', icon: Phone, match: (p: string) => p.startsWith('/calls') },
  { to: '/actions', label: 'Actions', icon: ListChecks, match: (p: string) => p.startsWith('/actions') },
  { to: '/settings', label: 'Settings', icon: Settings, match: (p: string) => p.startsWith('/settings') },
]
</script>

<template>
  <!--
    Horizontal tabs rather than a sidebar: the app renders inside a HighLevel
    iframe that already owns a left nav, so a second vertical rail reads as a
    competing app. Tabs sit where GHL puts its own sub-navigation.
  -->
  <div class="flex h-full flex-col">
    <header class="shrink-0 border-b border-hairline bg-surface">
      <div class="mx-auto flex max-w-6xl items-center gap-3 px-6 pt-3">
        <Activity class="size-5 shrink-0 text-series" aria-hidden="true" />
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold leading-tight">Voice AI Copilot</div>
          <div class="text-xs text-ink-3">Observability</div>
        </div>

        <div class="ml-auto flex items-center gap-4 text-xs text-ink-3">
          <div v-if="health" class="flex items-center gap-1.5">
            <span
              class="inline-block size-2 rounded-full"
              :class="health.status === 'ok' ? 'bg-good' : health.status === 'degraded' ? 'bg-warning' : 'bg-critical'"
              aria-hidden="true"
            />
            <span>{{ health.status === 'ok' ? 'All systems go' : `System ${health.status}` }}</span>
          </div>
          <span v-if="health?.fixtureMode">Demo data active</span>
          <button class="flex items-center gap-1.5 hover:text-ink" @click="signOut">
            <LogOut class="size-3.5" aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>

      <nav class="mx-auto max-w-6xl px-6" aria-label="Main">
        <div class="-mb-px flex items-center gap-1 overflow-x-auto">
          <RouterLink
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap"
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
    </header>

    <main class="min-w-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-6xl px-6 py-6">
        <slot />
      </div>
    </main>
  </div>
</template>
