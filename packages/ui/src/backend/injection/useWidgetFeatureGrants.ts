'use client'

import * as React from 'react'
import { useBackendChrome } from '../BackendChromeProvider'
import { useOptionalPortalContext } from '../../portal/PortalContext'

const EMPTY_FEATURES: string[] = []

export type WidgetFeatureGrants = {
  grantedFeatures: string[]
  hasAclSource: boolean
  isReady: boolean
}

/**
 * Resolves the ACL source used to gate feature-gated injection widgets: the staff
 * `BackendChromeProvider` payload when present, otherwise the customer portal session's
 * `resolvedFeatures`. Portal grants never include the bare `*` wildcard, so a customer can
 * never satisfy a staff-only feature through it. With neither source, `hasAclSource` is
 * `false` and callers must fail closed.
 */
export function useWidgetFeatureGrants(): WidgetFeatureGrants {
  const { payload, isReady: backendChromeReady } = useBackendChrome()
  const portal = useOptionalPortalContext()
  const hasBackendChromePayload = payload !== null
  const usesPortalGrants = !hasBackendChromePayload && portal !== null
  const backendFeatures = payload?.grantedFeatures
  const portalFeatures = usesPortalGrants ? portal.auth.resolvedFeatures : undefined
  const portalAuthLoading = usesPortalGrants && portal.auth.loading
  const grantedFeatures = React.useMemo(() => {
    if (hasBackendChromePayload) return backendFeatures ?? EMPTY_FEATURES
    if (!portalFeatures) return EMPTY_FEATURES
    return portalFeatures.filter((feature) => feature !== '*')
  }, [hasBackendChromePayload, backendFeatures, portalFeatures])
  return {
    grantedFeatures,
    hasAclSource: hasBackendChromePayload || usesPortalGrants,
    isReady: backendChromeReady && !portalAuthLoading,
  }
}
