"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AvailabilitySwitch } from './AvailabilitySwitch'
import { useUnavailabilities, type UnavailabilitiesState } from './useUnavailabilities'
import type { AvailabilityAncestor, AvailabilitySubject } from './availabilityModel'

export type AvailabilityCardProps = {
  subject: AvailabilitySubject
  buildingId: string
  ancestors?: readonly AvailabilityAncestor[]
  disabled?: boolean
  availability?: UnavailabilitiesState
  onChanged?: () => void
}

export function AvailabilityCard({ subject, buildingId, ancestors, disabled, availability, onChanged }: AvailabilityCardProps) {
  const t = useT()
  const ancestorKey = (ancestors ?? []).map((ancestor) => ancestor.id).join(',')
  const query = React.useMemo(
    () => (availability ? null : { buildingIds: [buildingId], exactSubjectIds: [subject.id, ...(ancestorKey ? ancestorKey.split(',') : [])] }),
    [ancestorKey, availability, buildingId, subject.id],
  )
  const ownAvailability = useUnavailabilities(query)
  const { rows, loading, refreshing, error, truncated, reload } = availability ?? ownAvailability
  return (
    <section className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-4" aria-labelledby={`pm-availability-${subject.id}`}>
      <div className="space-y-1">
        <h2 id={`pm-availability-${subject.id}`} className="text-base font-semibold">{t('property_management.availability.title', 'Availability')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('property_management.availability.description', 'While unavailable it takes no new leases or bookings. Switching it back on takes effect at once.')}
        </p>
      </div>
      <AvailabilitySwitch
        subject={subject}
        rows={rows}
        ancestors={ancestors}
        disabled={disabled}
        loading={loading}
        refreshing={refreshing}
        error={error}
        truncated={truncated}
        onRetry={reload}
        onChanged={() => {
          reload()
          onChanged?.()
        }}
      />
    </section>
  )
}
