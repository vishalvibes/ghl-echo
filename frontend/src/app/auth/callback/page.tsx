"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { useAuth } from "@/components/auth-provider"

// Google redirects back here with a `?code=`. The browser Supabase client
// (detectSessionInUrl) exchanges it for a session automatically; we just wait
// for that to land, then bounce home. No server route handler needed — this is
// a pure client-side SPA flow.
export default function AuthCallbackPage() {
  const router = useRouter()
  const { loading, session } = useAuth()

  useEffect(() => {
    if (!loading) router.replace(session ? "/" : "/?auth_error=1")
  }, [loading, session, router])

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </main>
  )
}
