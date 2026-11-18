"use client"

import * as React from 'react'
import Link from 'next/link'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { formatDate, LEASES_HREF } from '../leases/leaseModel'
import { closureReason, describeUnavailableUntil, formatTimeRange, type CrmAccess, type FloorPlanBooking, type FloorPlanUnit } from './floorPlanModel'
import { usePlural } from '../plural'
import { GatedLink, type LinkTarget } from '../featureLinks'
import { CrmHiddenNote as SharedCrmHiddenNote } from '../CrmHiddenNote'

export function DetailField({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="space-y-0.5" data-testid={testId}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

export function CrmHiddenNote() {
  return <SharedCrmHiddenNote testId="pm-floor-plan-crm-hidden" />
}

function customerLink(target: Extract<LinkTarget, 'person' | 'company'>, href: string, name: string | null | undefined) {
  if (!name) return <span>—</span>
  return <GatedLink target={target} href={href}>{name}</GatedLink>
}

function companyLink(id: string, name: string | null | undefined) {
  return customerLink('company', `/backend/customers/companies/${id}`, name)
}

export function UnavailableNotice({ unit }: { unit: FloorPlanUnit }) {
  const t = useT()
  const locale = useLocale()
  if (!unit.unavailable) return null
  const reason = unit.unavailable.source === 'building_archived'
    ? t('property_management.floorPlan.unavailable.archived', 'Building archived')
    : closureReason(t, unit.unavailable)
  return (
    <Alert status="warning" data-testid="pm-floor-plan-unavailable-notice">
      <AlertTitle>{t('property_management.floorPlan.status.unavailable', 'Unavailable')}</AlertTitle>
      <AlertDescription>
        {t('property_management.floorPlan.drawer.unavailableBody', '{reason}. {until}.', {
          reason,
          until: describeUnavailableUntil(t, unit.unavailable.until, locale),
        })}
      </AlertDescription>
    </Alert>
  )
}

export function LeaseEndingNotice({ unit }: { unit: FloorPlanUnit }) {
  const t = useT()
  const locale = useLocale()
  const { plural } = usePlural()
  if (!unit.leaseEnding || !unit.lease) return null
  const respondBy = unit.lease.extensionRespondBy
  const declined = unit.lease.extensionStatus === 'declined'
  return (
    <Alert status="warning" data-testid="pm-floor-plan-lease-ending">
      <AlertTitle>{plural('property_management.floorPlan.drawer.leaseEndsIn', 'Lease ends in {count} days', unit.lease.daysLeft)}</AlertTitle>
      <AlertDescription>
        {respondBy && declined
          ? t('property_management.floorPlan.drawer.leaseEndsOnWithDeclinedOffer', 'Ends on {date}. The extension offer was declined — still approvable until {respondBy}.', {
              date: formatDate(unit.lease.endsOn, locale),
              respondBy: formatDate(respondBy, locale),
            })
          : respondBy
          ? t('property_management.floorPlan.drawer.leaseEndsOnWithOffer', 'Ends on {date}. An extension offer is waiting for an answer by {respondBy}.', {
              date: formatDate(unit.lease.endsOn, locale),
              respondBy: formatDate(respondBy, locale),
            })
          : t('property_management.floorPlan.drawer.leaseEndsOn', 'Ends on {date}.', { date: formatDate(unit.lease.endsOn, locale) })}
      </AlertDescription>
    </Alert>
  )
}

export function LeaseFields({ unit, crmAccess }: { unit: FloorPlanUnit; crmAccess: CrmAccess }) {
  const t = useT()
  const locale = useLocale()
  const lease = unit.lease
  if (!lease) {
    if (unit.use === 'bookable' || unit.unavailable || unit.reservation) return null
    return (
      <div data-testid="pm-floor-plan-vacant">
        <dt className="sr-only">{t('property_management.floorPlan.drawer.tenant', 'Tenant')}</dt>
        <dd className="text-sm text-muted-foreground">{t('property_management.floorPlan.drawer.vacant', 'Vacant and ready to lease.')}</dd>
      </div>
    )
  }
  return (
    <>
      <DetailField label={t('property_management.floorPlan.drawer.tenant', 'Tenant')} testId="pm-floor-plan-tenant">
        {crmAccess.companies ? companyLink(lease.customerCompanyId, lease.companyName) : <CrmHiddenNote />}
      </DetailField>
      <DetailField label={t('property_management.floorPlan.drawer.lease', 'Lease')}>
        <Link href={`${LEASES_HREF}/${lease.id}`} className="hover:underline">{lease.reference}</Link>
      </DetailField>
      <DetailField label={t('property_management.floorPlan.drawer.term', 'Term')}>
        {t('property_management.floorPlan.drawer.termValue', '{start} to {end}', {
          start: formatDate(lease.startsOn, locale),
          end: formatDate(lease.endsOn, locale),
        })}
      </DetailField>
      <DetailField label={t('property_management.floorPlan.drawer.contact', 'Primary contact')}>
        {lease.contactPersonId && !crmAccess.people ? (
          <CrmHiddenNote />
        ) : lease.contactPersonId ? (
          <span className="flex flex-col">
            {customerLink('person', `/backend/customers/people/${lease.contactPersonId}`, lease.contactName)}
            {lease.contactEmail ? <span className="text-muted-foreground">{lease.contactEmail}</span> : null}
          </span>
        ) : (
          t('property_management.floorPlan.drawer.noContact', 'No contact person')
        )}
      </DetailField>
    </>
  )
}

export function ProposalFields({ unit, crmAccess }: { unit: FloorPlanUnit; crmAccess: CrmAccess }) {
  const t = useT()
  const locale = useLocale()
  const proposal = unit.proposal
  if (!unit.proposed || !proposal) return null
  const start = formatDate(proposal.startsOn, locale)
  const respondBy = !proposal.respondBy
    ? ''
    : proposal.status === 'declined'
      ? t('property_management.floorPlan.drawer.proposalDeclined', 'Declined — still approvable until {date}.', { date: formatDate(proposal.respondBy, locale) })
      : t('property_management.floorPlan.drawer.respondBy', 'Answer due by {date}.', { date: formatDate(proposal.respondBy, locale) })
  return (
    <Alert status="information" data-testid="pm-floor-plan-proposal">
      <AlertTitle>{t('property_management.floorPlan.drawer.proposalTitle', 'Held by proposal {reference}', { reference: proposal.reference })}</AlertTitle>
      <AlertDescription>
        {crmAccess.companies
          ? t('property_management.floorPlan.drawer.proposalBody', 'Offered to {company} from {start}. {respondBy}', { company: proposal.companyName || '—', start, respondBy })
          : t('property_management.floorPlan.drawer.proposalBodyNoCompany', 'Offered from {start}. {respondBy}', { start, respondBy })}
      </AlertDescription>
    </Alert>
  )
}

export function ReservationNotice({ unit }: { unit: FloorPlanUnit }) {
  const t = useT()
  const locale = useLocale()
  const reservation = unit.reservation
  if (!reservation) return null
  return (
    <Alert status="warning" data-testid="pm-floor-plan-reservation">
      <AlertTitle>{t('property_management.floorPlan.tile.reservedUntil', 'Reserved until {date}', { date: formatDate(reservation.until, locale) })}</AlertTitle>
      <AlertDescription>
        {t('property_management.floorPlan.drawer.reservedBody', 'Lease {reference} is being changed — its sales order update is still pending, so the unit stays reserved until then.', {
          reference: reservation.reference,
        })}
      </AlertDescription>
    </Alert>
  )
}

function BookingRow({ booking, crmAccess }: { booking: FloorPlanBooking; crmAccess: CrmAccess }) {
  const t = useT()
  const time = booking.billingUnit === 'day'
    ? t('property_management.floorPlan.drawer.wholeDay', 'Whole day')
    : formatTimeRange(booking)
  return (
    <li className="flex items-start justify-between gap-3 py-2" data-testid={`pm-floor-plan-booking-${booking.id}`}>
      <span className="font-mono text-sm">{time}</span>
      <span className="flex flex-col items-end text-right text-sm">
        {crmAccess.people ? customerLink('person', `/backend/customers/people/${booking.personId}`, booking.personName) : <CrmHiddenNote />}
        {crmAccess.companies && booking.companyName ? <span className="text-xs text-muted-foreground">{booking.companyName}</span> : null}
      </span>
    </li>
  )
}

export function BookingsList({ unit, date, crmAccess }: { unit: FloorPlanUnit; date: string; crmAccess: CrmAccess }) {
  const t = useT()
  const locale = useLocale()
  const bookings = unit.bookings ?? []
  if (unit.use !== 'bookable' && !bookings.length) return null
  return (
    <DetailField label={t('property_management.floorPlan.drawer.bookingsOn', 'Bookings on {date}', { date: formatDate(date, locale) })} testId="pm-floor-plan-bookings">
      {bookings.length ? (
        <ul className="divide-y divide-border">
          {bookings.map((booking) => <BookingRow key={booking.id} booking={booking} crmAccess={crmAccess} />)}
        </ul>
      ) : (
        <span className="text-muted-foreground">{t('property_management.floorPlan.tile.noBookings', 'No bookings on this day')}</span>
      )}
    </DetailField>
  )
}
