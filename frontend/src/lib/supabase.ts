// Browser Supabase client (singleton).
//
// This app is a client-side SPA: React Query calls the FastAPI backend with a
// Bearer token, and supabase-js manages the session in the browser. We do NOT
// use @supabase/ssr / cookies here — there is no server-side auth to keep in
// sync. The one job of this client is: sign in with Google, and hand out the
// current access token (see lib/api.ts and components/auth-provider.tsx).

import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
// New Supabase standard: the publishable key (sb_publishable_...) replaces the
// legacy anon key. Fall back to the anon var during migration.
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — " +
      "copy them from `make status` into frontend/.env.local",
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Defaults, made explicit: persist the session across reloads and finish
    // the OAuth (PKCE) code exchange automatically when we land back on the
    // /auth/callback URL with a `?code=`.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
})
