"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { useState } from "react"

import { AuthProvider } from "@/components/auth-provider"
import { makeQueryClient } from "@/lib/query-client"

export function Providers({ children }: { children: React.ReactNode }) {
  // useState so the client is created once per browser session and is never
  // recreated on re-render (nor shared across SSR requests).
  const [queryClient] = useState(makeQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  )
}
