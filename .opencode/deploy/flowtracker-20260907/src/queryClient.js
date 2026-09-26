import { QueryClient } from '@tanstack/react-query'

// Shared cache for server data. UI state (tabs, filters, scroll) remains in the
// owning modules and is deliberately not stored here.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 15 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      // A fresh entry is reused on navigation; stale data is refreshed in the
      // background when its view mounts again.
      refetchOnMount: true,
      retry: 1,
    },
  },
})
