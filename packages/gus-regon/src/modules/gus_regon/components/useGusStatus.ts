'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { GusStatus } from '../lib/status'

const CACHE_TTL_MS = 30_000
let cached: { at: number; promise: Promise<GusStatus | null> } | null = null

function fetchStatus(force: boolean): Promise<GusStatus | null> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.promise
  const promise = apiCall<GusStatus>('/api/gus_regon/status')
    .then((res) => (res.ok && res.result && typeof res.result.enabled === 'boolean' ? res.result : null))
    .catch(() => null)
  cached = { at: Date.now(), promise }
  return promise
}

/**
 * GUS availability for the current organization. `undefined` while loading,
 * `null` when the status could not be read (treat as "not available").
 * Shared, short-lived cache so several widgets on one page make one request.
 */
export function useGusStatus(refreshKey?: unknown): GusStatus | null | undefined {
  const [status, setStatus] = React.useState<GusStatus | null | undefined>(undefined)
  const firstRun = React.useRef(true)
  React.useEffect(() => {
    let active = true
    const force = !firstRun.current
    firstRun.current = false
    void fetchStatus(force).then((value) => {
      if (active) setStatus(value)
    })
    return () => {
      active = false
    }
  }, [refreshKey])
  return status
}
