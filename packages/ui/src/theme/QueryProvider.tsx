"use client"
import * as React from 'react'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { redirectToSessionRefresh, notifyForbiddenAccess, UnauthorizedError, ForbiddenError, apiFetch, setAuthRedirectConfig } from '../backend/utils/api'

// Ensure global fetch calls also flow through apiFetch so 401 session-refresh
// and 403 access-denied flash banners fire consistently.
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
      else if (error instanceof ForbiddenError) notifyForbiddenAccess()
      // As a fallback, try to detect common cases
      else if ((error as any)?.status === 401) redirectToSessionRefresh()
      else if ((error as any)?.status === 403) notifyForbiddenAccess()
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (error instanceof UnauthorizedError) redirectToSessionRefresh()
      else if (error instanceof ForbiddenError) notifyForbiddenAccess()
      else if ((error as any)?.status === 401) redirectToSessionRefresh()
      else if ((error as any)?.status === 403) notifyForbiddenAccess()
    },
  }),
})

type QueryProviderProps = { children: React.ReactNode; defaultForbiddenRoles?: string[] }

export function QueryProvider({ children, defaultForbiddenRoles }: QueryProviderProps) {
  React.useEffect(() => {
    ensureGlobalFetchInterception()
    if (defaultForbiddenRoles && defaultForbiddenRoles.length) {
      setAuthRedirectConfig({ defaultForbiddenRoles })
    }
  }, [])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
