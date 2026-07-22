"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { AppShell } from "@/components/app-shell"
import { useAuth } from "@/components/auth-provider"
import { Skeleton } from "@/components/ui/skeleton"

// Auth gate for every authenticated route. Auth is client-only (no @supabase/ssr
// cookies), so the guard is a client effect: no session → bounce to the login
// form at /. Nothing under (app) renders without a user.
export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace("/")
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center p-6">
        <Skeleton className="h-64 w-full max-w-2xl" />
      </main>
    )
  }

  return <AppShell>{children}</AppShell>
}
