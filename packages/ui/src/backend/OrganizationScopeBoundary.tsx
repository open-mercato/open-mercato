'use client'
import * as React from 'react'
import {
  subscribeOrganizationScopeChanged,
  type OrganizationScopeChangedDetail,
} from '@open-mercato/shared/lib/frontend/organizationEvents'

export type OrganizationScopeBoundaryProps = {
  active: boolean
  children: React.ReactNode
}

/**
 * Remounts its children whenever the active organization/tenant scope changes.
 *
 * The org/tenant switcher already calls `router.refresh()` on a scope change,
 * which re-runs server components but does NOT remount client components — so
 * settings pages that fetch their data once in a mount `useEffect` keep showing
 * the previous scope's values until a manual reload. Wrapping those pages here
 * forces a fresh mount (and therefore a refetch) on a real scope change.
 *
 * Gated by `active` so only the settings surface remounts; list/CRUD pages keep
 * relying on the smoother `router.refresh()` path that preserves table state.
 */
export function OrganizationScopeBoundary({ active, children }: OrganizationScopeBoundaryProps) {
  const [scopeKey, setScopeKey] = React.useState(0)
  const lastScopeRef = React.useRef<OrganizationScopeChangedDetail | null>(null)
  const hasInitializedScopeRef = React.useRef(false)

  React.useEffect(() => {
    return subscribeOrganizationScopeChanged((detail) => {
      const prev = lastScopeRef.current
      lastScopeRef.current = detail
      if (!hasInitializedScopeRef.current) {
        hasInitializedScopeRef.current = true
        return
      }
      if (
        prev &&
        prev.organizationId === detail.organizationId &&
        prev.tenantId === detail.tenantId
      ) {
        return
      }
      setScopeKey((current) => current + 1)
    })
  }, [])

  if (!active) {
    return <>{children}</>
  }

  return <React.Fragment key={scopeKey}>{children}</React.Fragment>
}
