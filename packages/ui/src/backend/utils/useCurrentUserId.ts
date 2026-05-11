'use client'
import * as React from 'react'
import { apiCall } from './apiCall'

type FeatureCheckResponse = {
  ok: boolean
  granted: string[]
  userId: string
}

/**
 * Read the current user's id on the client. Returns `''` until the request resolves.
 *
 * Implementation note: there is no first-class `/api/auth/me` endpoint yet, so this
 * piggy-backs on `/api/auth/feature-check` with an empty `features` array — the response
 * always carries the JWT `userId`. Replace with a dedicated `/api/auth/me` or an
 * SSR-bootstrapped user context once available, and remove this hop.
 */
export function useCurrentUserId(): string {
  const [userId, setUserId] = React.useState<string>('')
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: [] }),
        })
        if (!cancelled && res.ok && typeof res.result?.userId === 'string') {
          setUserId(res.result.userId)
        }
      } catch {
        if (!cancelled) setUserId('')
      }
    })()
    return () => { cancelled = true }
  }, [])
  return userId
}
