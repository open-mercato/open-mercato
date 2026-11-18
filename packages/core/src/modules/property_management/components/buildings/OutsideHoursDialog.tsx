"use client"

import * as React from 'react'
import Link from 'next/link'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { isSubmitShortcut } from './useBuildingUsage'
import { usePlural } from '../plural'
import { formatDate } from '../leases/leaseModel'
import { formatWallClockTime } from '../bookings/bookingModel'

export type OutsideHoursBooking = { id: string; productName: string; startsAt: string; endsAt: string }

export function OutsideHoursDialog({
  bookings,
  total,
  onClose,
}: {
  bookings: readonly OutsideHoursBooking[]
  total?: number
  onClose: () => void
}) {
  const t = useT()
  const count = Math.max(total ?? 0, bookings.length)
  const more = count - bookings.length
  const locale = useLocale()
  const { plural } = usePlural()
  return (
    <Dialog open={bookings.length > 0} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent onKeyDown={(event) => { if (isSubmitShortcut(event)) { event.preventDefault(); onClose() } }}>
        <DialogHeader>
          <DialogTitle>{plural('property_management.buildings.hours.outsideTitle', '{count} bookings are now outside the opening hours', count)}</DialogTitle>
          <DialogDescription>
            {t('property_management.buildings.hours.outsideHint', 'They were kept. Cancel them one by one if the building will be closed at those times.')}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-4 text-sm" data-testid="pm-outside-hours-bookings">
          {bookings.map((booking) => (
            <li key={booking.id}>
              <Link href={`/backend/property_management/bookings?id=${encodeURIComponent(booking.id)}`} className="hover:underline">
                {t('property_management.buildings.hours.outsideBooking', '{product} · {date}, {start}–{end}', {
                  product: booking.productName,
                  date: formatDate(booking.startsAt, locale),
                  start: formatWallClockTime(booking.startsAt, locale),
                  end: formatWallClockTime(booking.endsAt, locale),
                })}
              </Link>
            </li>
          ))}
        </ul>
        {more > 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="pm-outside-hours-more">
            {t('property_management.buildings.hours.outsideMore', 'and {count} more', { count: more })}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={onClose}>{t('property_management.common.close', 'Close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
