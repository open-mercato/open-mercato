"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { hasFeature } from '@open-mercato/shared/security/features'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('wms')

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
              'wms.manage_inventory',
              'wms.receive_inventory',
              'wms.manage_asn',
              'wms.manage_putaway',
              'wms.cycle_count',
              'wms.import',
              'wms.manage_reservations',
              'wms.manage_locations',
              'wms.manage_warehouses',
              'wms.manage_zones',
            ],
          }),
        })
        if (!cancelled) {
          setGranted(Array.isArray(call.result?.granted) ? call.result.granted : [])
          setUserId(typeof call.result?.userId === 'string' ? call.result.userId : null)
        }
      } catch (error) {
        logger.error('feature check failed', { component: 'useWmsInventoryMutationAccess', err: error })
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
    canManage: hasFeature(granted, 'wms.manage_inventory'),
    canReceive: hasFeature(granted, 'wms.receive_inventory'),
    canManageAsn: hasFeature(granted, 'wms.manage_asn'),
    canManagePutaway: hasFeature(granted, 'wms.manage_putaway'),
    canCycleCount: hasFeature(granted, 'wms.cycle_count'),
    canImport: hasFeature(granted, 'wms.import'),
    canMove: hasFeature(granted, 'wms.adjust_inventory'),
    canRelease: hasFeature(granted, 'wms.manage_reservations'),
    canReserve: hasFeature(granted, 'wms.manage_reservations'),
    canAllocate: hasFeature(granted, 'wms.manage_reservations'),
    canManageLocations: hasFeature(granted, 'wms.manage_locations'),
    canManageWarehouses: hasFeature(granted, 'wms.manage_warehouses'),
    canManageZones: hasFeature(granted, 'wms.manage_zones'),
    canManageLots: hasFeature(granted, 'wms.manage_inventory'),
  }
}
