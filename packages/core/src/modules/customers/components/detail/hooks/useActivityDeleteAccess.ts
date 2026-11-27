'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { matchFeature } from '@open-mercato/shared/lib/auth/featureMatch'
import type { InteractionSummary } from '../types'

const LEGACY_ACTIVITY_SOURCE = 'legacy-activity'
const MANAGE_INTERACTIONS_FEATURE = 'customers.interactions.manage'
const MANAGE_ACTIVITIES_FEATURE = 'customers.activities.manage'

type ActivityDeleteGrants = { interactions: boolean; activities: boolean }

const NO_GRANTS: ActivityDeleteGrants = { interactions: false, activities: false }

/**
 * The feature the delete endpoint for this row enforces: legacy-only rows go through the
 * activities adapter, every other row through the interactions endpoint.
 */
export function resolveActivityDeleteFeature(activity: Pick<InteractionSummary, 'source'>): string {
  return activity.source === LEGACY_ACTIVITY_SOURCE ? MANAGE_ACTIVITIES_FEATURE : MANAGE_INTERACTIONS_FEATURE
}

/**
 * Whether the current user may delete a given timeline row. Starts closed and stays closed
 * when the check fails, so Delete is offered only once the permission is confirmed. The
 * server enforces the feature either way; this keeps a view-only user from being walked
 * through a confirmation that ends in a refusal.
 */
export function useActivityDeleteAccess(): (activity: Pick<InteractionSummary, 'source'>) => boolean {
  const [grants, setGrants] = React.useState<ActivityDeleteGrants>(NO_GRANTS)
  React.useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    apiCall<{ granted?: unknown[] }>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ features: [MANAGE_INTERACTIONS_FEATURE, MANAGE_ACTIVITIES_FEATURE] }),
    })
      .then((call) => {
        if (cancelled || !call.ok) return
        const granted = Array.isArray(call.result?.granted)
          ? call.result.granted.map((feature) => String(feature))
          : []
        setGrants({
          interactions: granted.some((grantedFeature) => matchFeature(MANAGE_INTERACTIONS_FEATURE, grantedFeature)),
          activities: granted.some((grantedFeature) => matchFeature(MANAGE_ACTIVITIES_FEATURE, grantedFeature)),
        })
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) setGrants(NO_GRANTS)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])
  return React.useCallback(
    (activity) => (resolveActivityDeleteFeature(activity) === MANAGE_ACTIVITIES_FEATURE ? grants.activities : grants.interactions),
    [grants],
  )
}
