import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router.js'
import { bootstrapGhlSession } from './lib/api.js'
import './style.css'

// Establish the iframe session (if embedded) before the first query fires.
await bootstrapGhlSession()

createApp(App)
  .use(router)
  .use(VueQueryPlugin, {
    queryClientConfig: {
      defaultOptions: {
        queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
      },
    },
  })
  .mount('#app')
