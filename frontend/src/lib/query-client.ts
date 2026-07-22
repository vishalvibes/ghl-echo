import { QueryClient } from "@tanstack/react-query"

// Central QueryClient factory. In the App Router we create one instance per
// browser session (see components/providers.tsx) rather than a bare singleton,
// so state is never shared across requests during SSR.
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 1000 * 60 * 30,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}
