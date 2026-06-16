"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { hasFeature } from '@open-mercato/shared/security/features'

type FeatureCheckResponse = {
  ok?: boolean
  granted?: string[]
  userId?: string
}

export type WmsInventoryMutationAccess = ReturnType<typeof useWmsInventoryMutationAccess>

export function useWmsInventoryMutationAccess() {
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const [granted, setGranted] = React.useState<string[]>([])
  const [userId, setUserId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    async function load() {
      try {
        const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            features: [
              'wms.adjust_inventory',
              'wms.cycle_count',
              'wms.import',
              'wms.manage_reservations',
            ],
          }),
        })
        if (!cancelled) {
          setGranted(Array.isArray(call.result?.granted) ? call.result.granted : [])
          setUserId(typeof call.result?.userId === 'string' ? call.result.userId : null)
        }
      } catch (error) {
        console.error('[useWmsInventoryMutationAccess] feature check failed', error)
        if (!cancelled) {
          setGranted([])
          setUserId(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [organizationId, tenantId])

  const scopeReady = Boolean(organizationId && tenantId && userId)

  return {
    loading,
    organizationId,
    tenantId,
    userId,
    scopeReady,
    canAdjust: hasFeature(granted, 'wms.adjust_inventory'),
    canReceive: hasFeature(granted, 'wms.adjust_inventory'),
    canCycleCount: hasFeature(granted, 'wms.cycle_count'),
    canImport: hasFeature(granted, 'wms.import'),
    canMove: hasFeature(granted, 'wms.adjust_inventory'),
    canRelease: hasFeature(granted, 'wms.manage_reservations'),
  }
}
