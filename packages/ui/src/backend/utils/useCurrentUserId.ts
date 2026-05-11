'use client'
import * as React from 'react'
import { apiCall } from './apiCall'

type FeatureCheckResponse = {
  ok: boolean
  granted: string[]
  userId: string
}

/**
 * Read the current user's id on the client.
 *
 * Implemented as a side-channel POST to `/api/auth/feature-check` (with an empty
 * `features` array) because there's no first-class `/api/auth/me` endpoint yet
 * — the response always carries the JWT-embedded `userId`. Returns `''` until
 * the request resolves; callers can feed the returned value directly into
 * preset/build contexts that need the current user.
 *
 * TODO(SPEC-048 follow-up): replace with a dedicated `/api/auth/me` endpoint
 * (or SSR-bootstrapped user context) and remove this side-channel hop.
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
