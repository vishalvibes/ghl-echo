import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev: the Vue dev server proxies API paths to Fastify so
    // the session cookie is first-party and no CORS dance is needed.
    proxy: {
      '/api': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
      // GHL posts VoiceAiCallEnd to the same public tunnel that serves this
      // dev server, so it must reach Fastify rather than falling through to
      // the SPA's index.html. (The OAuth callback lives under /auth, above.)
      '/webhooks': 'http://localhost:8000',
    },
    // Vite blocks unrecognized Host headers by default (DNS-rebinding
    // protection) — the GHL Custom Page preview loads through the ngrok
    // tunnel domain, so it must be allowlisted here.
    allowedHosts: ['enjoyed-dinosaur-eternal.ngrok-free.app'],
  },
  test: {
    environment: 'happy-dom',
  },
})
