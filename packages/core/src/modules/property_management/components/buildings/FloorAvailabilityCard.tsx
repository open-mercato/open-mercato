"use client"

import * as React from 'react'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AvailabilitySwitch } from '../availability/AvailabilitySwitch'
import { AVAILABILITY_MANAGE_FEATURE } from '../availability/availabilityModel'
import type { UnavailabilitiesState } from '../availability/useUnavailabilities'

export type FloorAvailabilityCardProps = {
  buildingId: string
  floors: ReadonlyArray<{ id: string; name: string; number: number }>
  availability: UnavailabilitiesState
}

export function FloorAvailabilityCard({ buildingId, floors, availability }: FloorAvailabilityCardProps) {
  const t = useT()
  const { payload: chrome } = useBackendChrome()
  if (!floors.length || !hasFeature(chrome?.grantedFeatures, AVAILABILITY_MANAGE_FEATURE)) return null
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-labelledby="pm-floor-availability" data-testid="pm-floor-availability">
      <div className="space-y-1">
        <h2 id="pm-floor-availability" className="text-base font-semibold">{t('property_management.availability.floorsTitle', 'Floor availability')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('property_management.availability.description', 'While unavailable it takes no new leases or bookings. Switching it back on takes effect at once.')}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {floors.map((floor) => (
          <li key={floor.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
            <span>
              <span className="tabular-nums text-muted-foreground">{floor.number}</span> {floor.name}
            </span>
            <AvailabilitySwitch
              subject={{ type: 'floor', id: floor.id, name: floor.name }}
              rows={availability.rows}
              ancestors={[{ type: 'building', id: buildingId }]}
              loading={availability.loading}
              refreshing={availability.refreshing}
              error={availability.error}
              truncated={availability.truncated}
              onRetry={availability.reload}
              onChanged={availability.reload}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
