"use client"

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDate } from '../leases/leaseModel'
import { CrmHiddenNote } from '../CrmHiddenNote'
import { readCrmAccess } from '../crmAccess'
import { formatPreviewBookingTime, type UnavailabilityPreview } from './availabilityModel'

function CrmName({ allowed, name }: { allowed: boolean; name: string | null | undefined }) {
  if (!allowed) return <> · <CrmHiddenNote testId="pm-availability-crm-hidden" /></>
  return name ? <> · {name}</> : null
}

export function PreviewImpactLists({ preview }: { preview: UnavailabilityPreview }) {
  const t = useT()
  const locale = useLocale()
  const crmAccess = readCrmAccess(preview.crmAccess)
  return (
    <>
      {preview.bookingsToCancel.length ? (
        <ul className="mt-2 list-disc pl-4" data-testid="pm-availability-bookings">
          {preview.bookingsToCancel.map((booking) => (
            <li key={booking.id}>
              {[booking.unit, `${formatDate(booking.startsAt, locale)}, ${formatPreviewBookingTime(t, booking, locale)}`].filter(Boolean).join(' · ')}
              <CrmName allowed={crmAccess.people} name={booking.person} />
            </li>
          ))}
        </ul>
      ) : null}
      {preview.leasesToFlag.length ? (
        <ul className="mt-2 list-disc pl-4" data-testid="pm-availability-leases">
          {preview.leasesToFlag.map((lease) => (
            <li key={lease.id}>
              {lease.reference}
              <CrmName allowed={crmAccess.companies} name={lease.company} />
              {lease.unit ? ` · ${lease.unit}` : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
