<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import AppShell from './components/AppShell.vue'

const route = useRoute()
// Authentication and install-complete screens render outside the dashboard shell.
const bare = computed(() => route.name === 'login' || route.name === 'installed')
</script>

<template>
  <RouterView v-if="bare" />
  <AppShell v-else>
    <RouterView />
  </AppShell>
</template>
