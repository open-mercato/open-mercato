"use client"
import * as React from 'react'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { redirectToSessionRefresh, redirectToForbiddenLogin, UnauthorizedError, ForbiddenError, apiFetch } from '../backend/utils/api'

// Ensure global fetch calls also respect our redirect-on-401/403 policy.
function ensureGlobalFetchInterception() {
  if (typeof window === 'undefined') return
  const w = window as any
  if (w.__omFetchPatched) return
  w.__omFetchPatched = true
  w.__omOriginalFetch = window.fetch
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => apiFetch(input, init)) as any
}

const client = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof UnauthorizedError) redirectToSessionRefresh()
      else if (error instanceof ForbiddenError) redirectToForbiddenLogin()
      // As a fallback, try to detect common cases
      else if ((error as any)?.status === 401) redirectToSessionRefresh()
      else if ((error as any)?.status === 403) redirectToForbiddenLogin()
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (error instanceof UnauthorizedError) redirectToSessionRefresh()
      else if (error instanceof ForbiddenError) redirectToForbiddenLogin()
      else if ((error as any)?.status === 401) redirectToSessionRefresh()
      else if ((error as any)?.status === 403) redirectToForbiddenLogin()
    },
  }),
})

export function QueryProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    ensureGlobalFetchInterception()
  }, [])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
