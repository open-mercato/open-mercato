"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasStagingLocations } from './inventoryMutationLoaders'

export const WMS_LOCATIONS_HREF = '/backend/wms/locations'

export function useStagingLocationsMissing(warehouseId: string, enabled = true): boolean {
  const [missingFor, setMissingFor] = React.useState<string | null>(null)

  React.useEffect(() => {
    setMissingFor(null)
    if (!enabled || !warehouseId) return
    let cancelled = false
    hasStagingLocations(warehouseId)
      .then((available) => {
        if (!cancelled && !available) setMissingFor(warehouseId)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled, warehouseId])

  return enabled && warehouseId !== '' && missingFor === warehouseId
}

export function StagingLocationMissingHint() {
  const t = useT()
  return (
    <p className="text-xs text-muted-foreground" data-testid="wms-staging-location-missing-hint">
      {t(
        'wms.backend.asns.staging.missing.message',
        'This warehouse has no Dock or Staging location.',
      )}{' '}
      <Link href={WMS_LOCATIONS_HREF} className="font-medium text-primary hover:underline">
        {t('wms.backend.asns.staging.missing.action', 'Add one in WMS → Locations')}
      </Link>
    </p>
  )
}
