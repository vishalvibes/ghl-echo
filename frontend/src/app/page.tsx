"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { useAuth } from "@/components/auth-provider"
import { LoginForm } from "@/components/auth/login-form"
import { Skeleton } from "@/components/ui/skeleton"

// Root route = the auth gate. Signed out → the login form; signed in → bounce
// into the app shell at /chat. Every authenticated screen lives under (app).
export default function Home() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user) router.replace("/chat")
  }, [loading, user, router])

  if (loading || user) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center p-6">
        <Skeleton className="h-64 w-full max-w-sm" />
      </main>
    )
  }

  return <LoginForm />
}
