'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { GusStatus } from '../lib/status'

const CACHE_TTL_MS = 30_000
let cached: { at: number; scopeVersion: number; promise: Promise<GusStatus | null> } | null = null

function fetchStatus(force: boolean, scopeVersion: number): Promise<GusStatus | null> {
  if (!force && cached && cached.scopeVersion === scopeVersion && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.promise
  }
  const promise = apiCall<GusStatus>('/api/gus_regon/status')
    .then((res) => (res.ok && res.result && typeof res.result.enabled === 'boolean' ? res.result : null))
    .catch(() => null)
  cached = { at: Date.now(), scopeVersion, promise }
  return promise
}

/**
 * GUS availability for the current organization. `undefined` while loading,
 * `null` when the status could not be read (treat as "not available").
 * Shared, short-lived cache so several widgets on one page make one request.
 * Switching the active organization resets the status and refetches it for the
 * new scope, so a mounted form never keeps the previous organization's answer.
 */
export function useGusStatus(refreshKey?: unknown): GusStatus | null | undefined {
  const scopeVersion = useOrganizationScopeVersion()
  const [status, setStatus] = React.useState<GusStatus | null | undefined>(undefined)
  const lastRefreshKey = React.useRef(refreshKey)
  const lastScopeVersion = React.useRef(scopeVersion)
  React.useEffect(() => {
    let active = true
    const force = lastRefreshKey.current !== refreshKey
    lastRefreshKey.current = refreshKey
    if (lastScopeVersion.current !== scopeVersion) {
      lastScopeVersion.current = scopeVersion
      setStatus(undefined)
    }
    void fetchStatus(force, scopeVersion).then((value) => {
      if (active) setStatus(value)
    })
    return () => {
      active = false
    }
  }, [refreshKey, scopeVersion])
  return status
}
