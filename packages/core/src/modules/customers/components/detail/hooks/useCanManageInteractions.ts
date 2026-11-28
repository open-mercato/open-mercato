'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'

const MANAGE_INTERACTIONS_FEATURE = 'customers.interactions.manage'

/**
 * Whether the current user may create, edit, complete or cancel interactions. Starts as
 * `false` and stays `false` when the check fails, so write controls only appear once the
 * permission is confirmed. The server enforces the feature either way; this only keeps a
 * view-only user from being offered actions that would be refused.
 */
export function useCanManageInteractions(): boolean {
  const [canManage, setCanManage] = React.useState(false)
  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    apiCall<{ granted?: unknown[] }>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ features: [MANAGE_INTERACTIONS_FEATURE] }),
    })
      .then((call) => {
        if (cancelled || !call.ok) return
        const granted = Array.isArray(call.result?.granted)
          ? call.result.granted.map((feature) => String(feature))
          : []
        setCanManage(granted.some((grantedFeature) => matchFeature(MANAGE_INTERACTIONS_FEATURE, grantedFeature)))
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) setCanManage(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])
  return canManage
}
