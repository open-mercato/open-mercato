import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatDate } from '../leases/leaseModel'
import { formatWallClockRange } from '../bookings/bookingModel'
import { readCrmAccess, visibleCrmName, type CrmAccess } from '../crmAccess'

export const AVAILABILITY_MANAGE_FEATURE = 'property_management.availability.manage'
export const UNAVAILABILITY_RESOURCE_KIND = 'property_management.unavailability'

export type AvailabilitySubjectType = 'building' | 'floor' | 'space' | 'unit'

export type AvailabilitySubject = { type: AvailabilitySubjectType; id: string; name: string }

export type AvailabilityAncestor = { type: AvailabilitySubjectType; id: string }

export type UnavailabilityRow = {
  id: string
  buildingId: string
  subjectType: AvailabilitySubjectType
  subjectId: string
  reasonLabel: string | null
  reasonText: string
  startsAt: string
  endsAt: string | null
  effectiveEndsAt: string | null
  inEffect: boolean
  applyStatus: 'applied' | 'applying'
  updatedAt: string
}

export type PreviewBooking = { id: string; unit: string | null; startsAt: string; endsAt: string; person?: string | null }

export type PreviewLease = { id: string; reference: string; company?: string | null; unit: string | null }

export type UnavailabilityPreview = {
  unitCount: number
  bookingsToCancel: PreviewBooking[]
  bookingCount: number
  leasesToFlag: PreviewLease[]
  leaseCount: number
  previewToken: string
  crmAccess?: CrmAccess
}

export function applyPreviewCrmAccess(preview: UnavailabilityPreview): UnavailabilityPreview {
  const crmAccess = readCrmAccess(preview.crmAccess)
  const bookings = Array.isArray(preview.bookingsToCancel) ? preview.bookingsToCancel : []
  const leases = Array.isArray(preview.leasesToFlag) ? preview.leasesToFlag : []
  return {
    ...preview,
    crmAccess,
    bookingsToCancel: bookings.map((booking) => ({ ...booking, person: visibleCrmName(crmAccess.people, booking.person) })),
    leasesToFlag: leases.map((lease) => ({ ...lease, company: visibleCrmName(crmAccess.companies, lease.company) })),
  }
}

export function ownRows(rows: readonly UnavailabilityRow[], subject: { type: AvailabilitySubjectType; id: string }): UnavailabilityRow[] {
  return rows.filter((row) => row.subjectType === subject.type && row.subjectId === subject.id)
}

export function inheritedRow(rows: readonly UnavailabilityRow[], ancestors: readonly AvailabilityAncestor[]): UnavailabilityRow | null {
  for (const ancestor of ancestors) {
    const match = rows.find((row) => row.inEffect && row.subjectType === ancestor.type && row.subjectId === ancestor.id)
    if (match) return match
  }
  return null
}

export function addDaysToIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

export function startsAtOf(fromDate: string): string {
  return `${fromDate}T00:00`
}

export function endsAtOf(untilDate: string | null): string | null {
  return untilDate ? `${addDaysToIsoDate(untilDate, 1)}T00:00` : null
}

export function lastDayOf(endsAt: string): string {
  const date = endsAt.slice(0, 10)
  return endsAt.slice(11, 16) === '00:00' ? addDaysToIsoDate(date, -1) : date
}

export function formatPreviewBookingTime(t: TranslateFn, booking: { startsAt: string; endsAt: string }, locale: string): string {
  return formatWallClockRange(t, booking, locale)
}

export function reasonOf(row: Pick<UnavailabilityRow, 'reasonLabel' | 'reasonText'>): string {
  const label = row.reasonLabel?.trim() ?? ''
  const text = row.reasonText.trim()
  if (!label) return text
  const comparableText = text.toLocaleLowerCase()
  const comparableLabel = label.toLocaleLowerCase()
  if (!text || comparableText === comparableLabel) return label
  if (comparableText.startsWith(comparableLabel)) {
    const rest = text.slice(label.length).replace(/^[\s—–:-]+/, '')
    return rest ? `${label} — ${rest}` : label
  }
  return `${label} — ${text}`
}

export function describeRow(t: TranslateFn, row: UnavailabilityRow, locale: string): string {
  const reason = reasonOf(row)
  if (!row.inEffect) {
    return t('property_management.availability.hint.scheduled', '{reason} · from {date}', { reason, date: formatDate(row.startsAt, locale) })
  }
  if (!row.effectiveEndsAt) return t('property_management.availability.hint.openEnded', '{reason} · until further notice', { reason })
  return t('property_management.availability.hint.until', '{reason} · until {date}', { reason, date: formatDate(lastDayOf(row.effectiveEndsAt), locale) })
}

export function subjectTypeLabel(t: TranslateFn, type: AvailabilitySubjectType): string {
  const fallbacks: Record<AvailabilitySubjectType, string> = { building: 'building', floor: 'floor', space: 'space', unit: 'unit' }
  return t(`property_management.availability.subject.${type}`, fallbacks[type])
}
