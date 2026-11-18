import {
  addDays,
  anniversary,
  compareIsoDates,
  daysBetween,
  endsOn as recurrenceEndsOn,
  isIsoDate,
  localToday,
  type RecurrenceSchedule,
} from '@open-mercato/core/modules/sales/lib/recurrence'
import type { LeaseChangeKind } from '../data/entities'

export { addDays, compareIsoDates, isIsoDate, localToday }

export type LeaseSchedule = { startsOn: string; months: number; anchorDay?: number | null }

function dayOf(isoDate: string): number {
  return Number(isoDate.slice(8, 10))
}

export function monthlySchedule(schedule: LeaseSchedule): RecurrenceSchedule {
  return {
    frequency: 'monthly',
    startsOn: schedule.startsOn,
    anchorDay: schedule.anchorDay ?? null,
    periodCount: schedule.months,
  }
}

export function leaseEndsOn(startsOn: string, months: number, anchorDay?: number | null): string {
  if (!Number.isInteger(months) || months < 1) throw new Error(`[internal] Invalid lease term: ${months}`)
  const end = recurrenceEndsOn(monthlySchedule({ startsOn, months, anchorDay }))
  if (!end) throw new Error('[internal] A lease term always ends')
  return end
}

export function leaseAnniversary(startsOn: string, index: number, anchorDay?: number | null): string {
  return anniversary(monthlySchedule({ startsOn, months: index + 1, anchorDay }), index)
}

export function extensionAnchorDay(originalStartsOn: string, extensionStartsOn: string): number | null {
  const anchor = dayOf(originalStartsOn)
  const startDay = dayOf(extensionStartsOn)
  if (anchor === startDay) return null
  const [year, month] = extensionStartsOn.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Math.min(anchor, lastDay) === startDay ? anchor : null
}

export function extensionStartsOn(currentEndsOn: string): string {
  return addDays(currentEndsOn, 1)
}

export function monthsRemainingAfter(startsOn: string, months: number, date: string, anchorDay?: number | null): number {
  let remaining = 0
  for (let index = 0; index < months; index += 1) {
    if (compareIsoDates(leaseAnniversary(startsOn, index, anchorDay), date) > 0) remaining += 1
  }
  return remaining
}

export function nextAnniversaryAfter(startsOn: string, months: number, date: string, anchorDay?: number | null): string | null {
  for (let index = 0; index < months; index += 1) {
    const candidate = leaseAnniversary(startsOn, index, anchorDay)
    if (compareIsoDates(candidate, date) > 0) return candidate
  }
  return null
}

export function rangesOverlap(left: { startsOn: string; endsOn: string }, right: { startsOn: string; endsOn: string }): boolean {
  return compareIsoDates(left.startsOn, right.endsOn) <= 0 && compareIsoDates(right.startsOn, left.endsOn) <= 0
}

const DATE_CHANGING_KINDS: ReadonlySet<LeaseChangeKind> = new Set(['end', 'reschedule'])

export type ReservableLease = {
  startsOn: string
  endsOn: string
  pendingChange?: { kind: LeaseChangeKind; previous: { startsOn: string; endsOn: string } } | null
}

export function reservedInterval(lease: ReservableLease): { startsOn: string; endsOn: string } {
  const change = lease.pendingChange
  if (!change || !DATE_CHANGING_KINDS.has(change.kind)) return { startsOn: lease.startsOn, endsOn: lease.endsOn }
  const { previous } = change
  return {
    startsOn: compareIsoDates(previous.startsOn, lease.startsOn) < 0 ? previous.startsOn : lease.startsOn,
    endsOn: compareIsoDates(previous.endsOn, lease.endsOn) > 0 ? previous.endsOn : lease.endsOn,
  }
}

export function daysUntil(date: string, today: string = localToday()): number {
  return daysBetween(today, date)
}

export function respondByDate(expiresInDays: number, today: string = localToday()): string {
  return addDays(today, expiresInDays)
}

export function cancelEffectiveOn(newEndsOn: string, orderStartsOn: string): string {
  const dayAfter = addDays(newEndsOn, 1)
  return compareIsoDates(dayAfter, orderStartsOn) < 0 ? orderStartsOn : dayAfter
}
