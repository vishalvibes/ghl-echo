<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Activity, Loader2 } from 'lucide-vue-next'
import { ApiError, login } from '../lib/api.js'

/**
 * The only unauthenticated screen: standalone email + password gate, laid out
 * like a hosted-login panel — centred card with a brand accent, wordmark,
 * roomy fields, one primary action. Inside HighLevel this screen is never
 * seen: the iframe context exchange signs the user in silently.
 */
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const pending = ref(false)
const error = ref<string | null>(null)

async function submit() {
  error.value = null
  pending.value = true
  try {
    await login(email.value, password.value)
    const next = typeof route.query.next === 'string' ? route.query.next : '/'
    await router.replace(next.startsWith('/') ? next : '/')
  } catch (err) {
    error.value =
      err instanceof ApiError && typeof err.body === 'string'
        ? err.body
        : 'Something went wrong — try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="login-wash flex min-h-full flex-1 items-center justify-center px-6 py-16">
    <div class="w-full max-w-md overflow-hidden rounded-2xl border border-hairline bg-surface shadow-lg shadow-black/10">
      <!-- brand accent, mirroring the hosted-login top border -->
      <div class="h-1 bg-series" aria-hidden="true" />
      <div class="p-8">
        <div class="flex items-center gap-2 pb-1.5">
          <Activity class="size-6 text-series" aria-hidden="true" />
          <span class="text-lg font-semibold tracking-tight">Echo</span>
        </div>
        <p class="pb-6 text-sm text-ink-2">Sign in to continue.</p>

        <form class="flex flex-col gap-5" @submit.prevent="submit">
          <div class="flex flex-col gap-2">
            <label for="email" class="text-[0.9375rem] font-medium">Email</label>
            <input
              id="email"
              v-model="email"
              type="email"
              autocomplete="email"
              required
              placeholder="you@example.com"
              class="h-12 rounded-xl border border-hairline bg-surface px-4 text-base outline-none focus:border-series"
            />
          </div>

          <div class="flex flex-col gap-2">
            <label for="password" class="text-[0.9375rem] font-medium">Password</label>
            <input
              id="password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
              placeholder="••••••••"
              class="h-12 rounded-xl border border-hairline bg-surface px-4 text-base outline-none focus:border-series"
            />
          </div>

          <p v-if="error" role="alert" class="text-sm text-critical">{{ error }}</p>

          <button
            type="submit"
            :disabled="pending"
            class="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-series text-base font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            <Loader2 v-if="pending" class="size-5 animate-spin" aria-hidden="true" />
            Sign in
          </button>
        </form>

        <div class="mt-6 flex items-center gap-3 text-sm text-ink-3" aria-hidden="true">
          <span class="h-px flex-1 bg-hairline" />
          or
          <span class="h-px flex-1 bg-hairline" />
        </div>

        <p class="mt-4 text-center text-sm text-ink-2">
          Using HighLevel? Open the app from your sub-account menu — it signs you in automatically.
        </p>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* Faint blue wash behind the auth screen. */
.login-wash {
  background-image:
    radial-gradient(58rem 30rem at 12% -12%, rgba(24, 139, 246, 0.16), transparent 62%),
    radial-gradient(48rem 26rem at 92% 4%, rgba(13, 35, 102, 0.08), transparent 62%);
}
</style>
