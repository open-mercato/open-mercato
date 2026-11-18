"use client"

import * as React from 'react'
import Link from 'next/link'
import { CalendarClock, DoorOpen } from 'lucide-react'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Drawer, DrawerBody, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@open-mercato/ui/primitives/drawer'
import { BOOKINGS_HREF } from '../bookings/bookingModel'
import { LEASES_HREF } from '../leases/leaseModel'
import { useCanManageProperty } from '../manageAccess'
import { GatedLink } from '../featureLinks'
import { formatSize, UNIT_STATUS_VARIANTS, unitStatusLabel, unitStatusOf, type CrmAccess, type FloorPlanUnit } from './floorPlanModel'
import { BookingsList, DetailField, LeaseEndingNotice, LeaseFields, ProposalFields, ReservationNotice, UnavailableNotice } from './UnitDetailSections'

export type UnitDetailDrawerProps = {
  unit: FloorPlanUnit | null
  date: string
  crmAccess: CrmAccess
  onClose: () => void
}

function productUseLabel(t: TranslateFn, unit: FloorPlanUnit): string {
  if (unit.use === 'bookable') return t('property_management.floorPlan.drawer.useBookable', 'Bookable')
  if (unit.use === 'leasable') return t('property_management.floorPlan.drawer.useLeasable', 'Leasable')
  return t('property_management.floorPlan.drawer.useNone', 'Not offered')
}

export function UnitDetailDrawer({ unit, date, crmAccess, onClose }: UnitDetailDrawerProps) {
  const t = useT()
  return (
    <Drawer open={unit !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DrawerContent closeAriaLabel={t('property_management.common.close', 'Close')} data-testid="pm-floor-plan-drawer">
        {unit ? <UnitDetailContent unit={unit} date={date} crmAccess={crmAccess} /> : null}
      </DrawerContent>
    </Drawer>
  )
}

function UnitDetailContent({ unit, date, crmAccess }: { unit: FloorPlanUnit; date: string; crmAccess: CrmAccess }) {
  const t = useT()
  const locale = useLocale()
  const canEditUnit = useCanManageProperty()
  const status = unitStatusOf(unit)
  const bookable = unit.use === 'bookable'
  const Icon = bookable ? CalendarClock : DoorOpen
  const bookingsHref = `${BOOKINGS_HREF}?${new URLSearchParams({ unitId: unit.id, unitName: unit.name, date }).toString()}`
  const leaseId = unit.lease?.id ?? unit.proposal?.leaseId ?? unit.reservation?.leaseId ?? null
  const leaseHref = leaseId ? `${LEASES_HREF}/${leaseId}` : null
  return (
    <>
      <DrawerHeader leading={<Icon className="size-4" />}>
        <DrawerTitle>{unit.name}</DrawerTitle>
        <DrawerDescription asChild>
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge variant={UNIT_STATUS_VARIANTS[status]} dot>{unitStatusLabel(t, status)}</StatusBadge>
          </div>
        </DrawerDescription>
      </DrawerHeader>
      <DrawerBody>
        <div className="space-y-4 pb-4">
          <UnavailableNotice unit={unit} />
          <ReservationNotice unit={unit} />
          <LeaseEndingNotice unit={unit} />
          <ProposalFields unit={unit} crmAccess={crmAccess} />
          <dl className="space-y-3">
            <DetailField label={t('property_management.floorPlan.drawer.type', 'Type')}>
              {unit.categoryName ?? '—'} ({productUseLabel(t, unit)})
            </DetailField>
            <DetailField label={t('property_management.floorPlan.drawer.product', 'Product')}>
              <GatedLink target="product" href={`/backend/catalog/products/${unit.catalogProductId}`}>{unit.productName ?? '—'}</GatedLink>
            </DetailField>
            <DetailField label={t('property_management.floorPlan.drawer.size', 'Size')}>{formatSize(t, unit, locale)}</DetailField>
            <LeaseFields unit={unit} crmAccess={crmAccess} />
            <BookingsList unit={unit} date={date} crmAccess={crmAccess} />
          </dl>
          <Alert status="information">
            <AlertDescription>
              {bookable
                ? t('property_management.floorPlan.drawer.readOnlyBookings', 'Read-only. Bookings come in through the API — there is no backoffice booking screen. View and cancel them under Bookings.')
                : t('property_management.floorPlan.drawer.readOnlyLeases', 'Read-only. Lease changes are made under Leases.')}
            </AlertDescription>
          </Alert>
        </div>
      </DrawerBody>
      <DrawerFooter>
        {leaseHref ? (
          <Button asChild variant="outline">
            <Link href={leaseHref} data-testid="pm-floor-plan-open-lease">{t('property_management.floorPlan.drawer.openLease', 'Open lease')}</Link>
          </Button>
        ) : null}
        {bookable ? (
          <Button asChild variant="outline">
            <Link href={bookingsHref} data-testid="pm-floor-plan-open-bookings">{t('property_management.floorPlan.drawer.openBookings', 'Open bookings')}</Link>
          </Button>
        ) : null}
        {canEditUnit ? (
          <Button asChild variant="outline">
            <Link href={`/backend/property_management/units/${unit.id}`}>{t('property_management.floorPlan.drawer.editUnit', 'Edit unit')}</Link>
          </Button>
        ) : null}
        <DrawerClose asChild>
          <Button type="button">{t('property_management.common.close', 'Close')}</Button>
        </DrawerClose>
      </DrawerFooter>
    </>
  )
}
