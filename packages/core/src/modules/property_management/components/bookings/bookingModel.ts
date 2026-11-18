import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatDate, formatMoney } from '../leases/leaseModel'
import { visibleCrmName, type CrmAccess } from '../crmAccess'
import { compareWallClock, localNow, normalizeWallClock, parseWallClock } from '../../lib/wallClock'

export const BOOKINGS_HREF = '/backend/property_management/bookings'
export const BOOKINGS_MANAGE_FEATURE = 'property_management.bookings.manage'
export const BOOKING_RESOURCE_KIND = 'property_management.booking'

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled'

export type BookingSummary = {
  id: string
  status: BookingStatus
  buildingId: string
  buildingName: string | null
  unitId: string
  unitName: string | null
  floorName: string | null
  bookedByPersonId: string
  bookedByName?: string | null
  customerCompanyId: string | null
  companyName?: string | null
  startsAt: string
  endsAt: string
  productName: string
  unitPrice: string
  quantity: number
  billingUnit: 'hour' | 'day'
  totalAmount: string
  currencyCode: string | null
  cancelReason: string | null
  salesOrderId: string | null
  salesOrderNumber: string | null
  salesOrderCancelled: boolean
  cancellable?: boolean
  updatedAt: string
}

export const BOOKING_STATE_FILTERS: Record<string, string> = {
  all: '',
  active: 'pending,confirmed',
  past: 'completed,cancelled',
}

export function applyBookingsCrmAccess(rows: readonly BookingSummary[], access: CrmAccess): BookingSummary[] {
  return rows.map((row) => ({
    ...row,
    bookedByName: visibleCrmName(access.people, row.bookedByName),
    companyName: visibleCrmName(access.companies, row.companyName),
  }))
}

export function bookingHasEnded(booking: Pick<BookingSummary, 'endsAt'>, now: string = localNow()): boolean {
  if (!parseWallClock(booking.endsAt)) return false
  return compareWallClock(normalizeWallClock(booking.endsAt), now) <= 0
}

export function canCancelBooking(booking: Pick<BookingSummary, 'status' | 'endsAt' | 'cancellable'>, now: string = localNow()): boolean {
  if (typeof booking.cancellable === 'boolean') return booking.cancellable
  return (booking.status === 'pending' || booking.status === 'confirmed') && !bookingHasEnded(booking, now)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function unitFilterLabel(t: TranslateFn, unitName: string | null | undefined): string {
  const name = unitName?.trim()
  return name
    ? t('property_management.bookings.list.unitFilter', 'Only unit {name}', { name })
    : t('property_management.bookings.list.unitFilterUnnamed', 'Only the selected unit')
}

export type BookingStatusBadge = { variant: StatusBadgeVariant; appearance?: 'stroke' }

const BOOKING_STATUS_BADGES: Record<BookingStatus, BookingStatusBadge> = {
  pending: { variant: 'info' },
  confirmed: { variant: 'success' },
  completed: { variant: 'neutral' },
  cancelled: { variant: 'neutral', appearance: 'stroke' },
}

export function bookingStatusBadge(status: BookingStatus): BookingStatusBadge {
  return BOOKING_STATUS_BADGES[status] ?? { variant: 'neutral' }
}

export function bookingStatusLabel(t: TranslateFn, status: string): string {
  const fallbacks: Record<string, string> = {
    pending: 'Confirming…',
    confirmed: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
  }
  return t(`property_management.bookings.status.${status}`, fallbacks[status] ?? status)
}

export function formatBookingTime(
  t: TranslateFn,
  booking: Pick<BookingSummary, 'startsAt' | 'endsAt' | 'billingUnit'>,
  locale: string,
): { date: string; time: string } {
  const date = formatDate(booking.startsAt.slice(0, 10), locale)
  if (booking.billingUnit === 'day') return { date, time: t('property_management.floorPlan.drawer.wholeDay', 'Whole day') }
  return { date, time: formatWallClockRange(t, booking, locale) }
}

export function formatWallClockRange(t: TranslateFn, range: { startsAt: string; endsAt: string }, locale: string): string {
  const endsAtMidnight = range.endsAt.slice(11, 16) === '00:00' && range.endsAt.slice(0, 10) > range.startsAt.slice(0, 10)
  if (endsAtMidnight && range.startsAt.slice(11, 16) === '00:00') return t('property_management.floorPlan.drawer.wholeDay', 'Whole day')
  const end = endsAtMidnight ? t('property_management.buildings.hours.midnight', 'midnight') : formatWallClockTime(range.endsAt, locale)
  return `${formatWallClockTime(range.startsAt, locale)}–${end}`
}

export function formatWallClockTime(value: string, locale: string): string {
  const [hours, minutes] = value.slice(11, 16).split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value.slice(11, 16)
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1, hours, minutes)))
}

export function formatBookedAs(t: TranslateFn, booking: BookingSummary, locale: string): { product: string; price: string; rate: string } {
  const unitLabel = booking.billingUnit === 'day'
    ? t('property_management.bookings.rate.day', '{price} / day', { price: formatMoney(booking.unitPrice, booking.currencyCode, locale) })
    : t('property_management.bookings.rate.hour', '{price} / hour', { price: formatMoney(booking.unitPrice, booking.currencyCode, locale) })
  return {
    product: booking.productName,
    price: formatMoney(booking.totalAmount, booking.currencyCode, locale),
    rate: `${booking.quantity} × ${unitLabel}`,
  }
}

export function toIsoDay(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

export function fromIsoDay(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}
