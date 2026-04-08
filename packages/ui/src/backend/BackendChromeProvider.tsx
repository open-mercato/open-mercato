'use client'

import * as React from 'react'
import { apiCall } from './utils/apiCall'
import { subscribeOrganizationScopeChanged, getCurrentOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/organizationEvents'
import type { BackendChromePayload } from '@open-mercato/shared/modules/navigation/backendChrome'

type BackendChromeContextValue = {
  payload: BackendChromePayload | null
  isLoading: boolean
  isReady: boolean
  refresh: () => Promise<void>
}

type BackendChromeProviderProps = {
  adminNavApi?: string
  children: React.ReactNode
}

const chromeCache = new Map<string, BackendChromePayload>()
const BackendChromeContext = React.createContext<BackendChromeContextValue | null>(null)

function buildCacheKey(api: string): string {
  return `${api}::scope:${getCurrentOrganizationScopeVersion()}`
}

export function BackendChromeProvider({ adminNavApi, children }: BackendChromeProviderProps) {
  const cachedPayload = React.useMemo(() => {
    if (!adminNavApi) return null
    return chromeCache.get(buildCacheKey(adminNavApi)) ?? null
  }, [adminNavApi])
  const [payload, setPayload] = React.useState<BackendChromePayload | null>(cachedPayload)
  const [isLoading, setIsLoading] = React.useState(Boolean(adminNavApi && !cachedPayload))

  const refresh = React.useCallback(async () => {
    if (!adminNavApi) return
    setIsLoading(true)
    try {
      const call = await apiCall<BackendChromePayload>(adminNavApi, { credentials: 'include' as never })
      if (!call.ok || !call.result) return
      const nextPayload = call.result
      chromeCache.set(buildCacheKey(adminNavApi), nextPayload)
      setPayload(nextPayload)
    } finally {
      setIsLoading(false)
    }
  }, [adminNavApi])

  React.useEffect(() => {
    if (!adminNavApi) {
      setPayload(null)
      setIsLoading(false)
      return
    }
    const cached = chromeCache.get(buildCacheKey(adminNavApi)) ?? null
    setPayload(cached)
    if (!cached) {
      void refresh()
    }
  }, [adminNavApi, refresh])

  React.useEffect(() => {
    if (!adminNavApi) return
    const onFocus = () => { void refresh() }
    const onManualRefresh = () => { void refresh() }
    const unsubscribeScope = subscribeOrganizationScopeChanged(() => {
      void refresh()
    })
    window.addEventListener('focus', onFocus)
    window.addEventListener('om:refresh-sidebar', onManualRefresh as EventListener)
    return () => {
      unsubscribeScope()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('om:refresh-sidebar', onManualRefresh as EventListener)
    }
  }, [adminNavApi, refresh])

  const value = React.useMemo<BackendChromeContextValue>(() => ({
    payload,
    isLoading,
    isReady: !adminNavApi || payload !== null,
    refresh,
  }), [adminNavApi, isLoading, payload, refresh])

  return (
    <BackendChromeContext.Provider value={value}>
      {children}
    </BackendChromeContext.Provider>
  )
}

export function useBackendChrome(): BackendChromeContextValue {
  return React.useContext(BackendChromeContext) ?? {
    payload: null,
    isLoading: false,
    isReady: true,
    refresh: async () => {},
  }
}
