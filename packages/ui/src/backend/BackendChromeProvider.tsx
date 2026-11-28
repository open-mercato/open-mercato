'use client'

import * as React from 'react'
import { apiCall } from './utils/apiCall'
import { subscribeOrganizationScopeChanged, getCurrentOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/organizationEvents'
import type {
  BackendChromeCurrentOrganization,
  BackendChromePayload,
} from '@open-mercato/shared/modules/navigation/backendChrome'

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
type ScopedChrome = { state: 'pending' | 'failed' | 'ready'; features?: readonly string[] }
const unconfiguredChrome: ScopedChrome = { state: 'ready' }
const ChromePolicyContext = React.createContext<ScopedChrome>(unconfiguredChrome)
const serverEpoch = () => 0

export function useBackendChromePolicy(): ScopedChrome {
  return React.useContext(ChromePolicyContext)
}

export function BackendChromeProvider({ adminNavApi, children }: BackendChromeProviderProps) {
  const epoch = React.useSyncExternalStore(subscribeOrganizationScopeChanged, getCurrentOrganizationScopeVersion, serverEpoch)
  const cacheKey = adminNavApi ? JSON.stringify([adminNavApi, epoch]) : undefined
  const cached = cacheKey ? chromeCache.get(cacheKey) : undefined
  const [payload, setPayload] = React.useState<BackendChromePayload | null>(cached ?? null)
  const [isLoading, setIsLoading] = React.useState(Boolean(adminNavApi && !cached))
  const [failedKey, setFailedKey] = React.useState<string>()
  const activeKey = React.useRef(cacheKey)
  const activeRequest = React.useRef<AbortController | null>(null)

  React.useLayoutEffect(() => {
    activeKey.current = cacheKey
    return () => {
      activeKey.current = undefined
      activeRequest.current?.abort()
    }
  }, [cacheKey])

  const refresh = React.useCallback(async () => {
    if (!adminNavApi || !cacheKey || activeKey.current !== cacheKey || getCurrentOrganizationScopeVersion() !== epoch) return
    activeRequest.current?.abort()
    const request = new AbortController()
    activeRequest.current = request
    const current = () => !request.signal.aborted && activeRequest.current === request
      && activeKey.current === cacheKey && getCurrentOrganizationScopeVersion() === epoch

    setIsLoading(true)
    await Promise.resolve()
    if (!current()) return
    try {
      const call = await apiCall<BackendChromePayload>(adminNavApi, { credentials: 'include', signal: request.signal })
      if (!current()) return
      const next = call.ok && call.result
      if (!next || !Array.isArray(next.grantedFeatures) || next.grantedFeatures.some((feature) => typeof feature !== 'string')) {
        if (!chromeCache.has(cacheKey)) setFailedKey(cacheKey)
        return
      }
      chromeCache.set(cacheKey, next)
      setFailedKey(undefined)
      setPayload(next)
    } catch {
      if (current() && !chromeCache.has(cacheKey)) setFailedKey(cacheKey)
    } finally {
      if (current()) setIsLoading(false)
    }
  }, [adminNavApi, cacheKey, epoch])

  React.useEffect(() => {
    if (!cacheKey) {
      setPayload(null)
      setIsLoading(false)
      return
    }
    const available = chromeCache.get(cacheKey)
    if (available) {
      setPayload(available)
      setIsLoading(false)
    } else {
      void refresh()
    }
    const onRefresh = () => { void refresh() }
    window.addEventListener('focus', onRefresh)
    window.addEventListener('om:refresh-sidebar', onRefresh)
    return () => {
      activeRequest.current?.abort()
      window.removeEventListener('focus', onRefresh)
      window.removeEventListener('om:refresh-sidebar', onRefresh)
    }
  }, [cacheKey, refresh])

  const signature = cached && JSON.stringify([...new Set(cached.grantedFeatures)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0))
  const policy = React.useMemo<ScopedChrome>(() => {
    if (!cacheKey) return unconfiguredChrome
    if (signature) return { state: 'ready', features: JSON.parse(signature) }
    return { state: failedKey === cacheKey ? 'failed' : 'pending' }
  }, [cacheKey, signature, failedKey])
  const value = React.useMemo<BackendChromeContextValue>(() => ({
    payload,
    isLoading,
    isReady: !adminNavApi || payload !== null,
    refresh,
  }), [adminNavApi, isLoading, payload, refresh])

  return (
    <BackendChromeContext.Provider value={value}>
      <ChromePolicyContext.Provider value={policy}>{children}</ChromePolicyContext.Provider>
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

/**
 * The organization the backend chrome is currently scoped to, for UI that needs to label
 * "you are viewing: <name>".
 *
 * Reads the payload this provider already holds, so it costs no additional request. Returns `null`
 * under an all-organizations selection, outside a provider, or before the payload has arrived — treat
 * it as "unknown", not as "no organization".
 *
 * Prefer this over `payload.brand`, which only populates when the organization has a logo configured.
 */
export function useCurrentOrganization(): BackendChromeCurrentOrganization | null {
  const { payload } = useBackendChrome()
  return payload?.currentOrganization ?? null
}
