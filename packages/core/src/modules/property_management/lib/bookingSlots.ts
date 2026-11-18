import type { BillingUnit } from '../data/entities'
import {
  addMinutes,
  atMinuteOfDay,
  compareWallClock,
  datePartOf,
  endOfDay,
  isOnTheHour,
  MINUTES_PER_DAY,
  startOfDay,
  timeOfDayToMinutes,
  toMinutes,
} from './wallClock'

export const MAX_HOURLY_BOOKING_HOURS = 10
const MINUTES_PER_HOUR = 60

export type TimeRange = { start: string; end: string }
export type OpeningWindow = { opensAt: string; closesAt: string }
export type SlotState = 'free' | 'booked'
export type Slot = TimeRange & { state: SlotState }
export type BookableBillingUnit = Extract<BillingUnit, 'hour' | 'day'>

export type DaySlotsInput = {
  date: string
  billingUnit: BookableBillingUnit
  opening?: OpeningWindow | null
  blocked?: readonly TimeRange[]
  booked?: readonly TimeRange[]
  now?: string
}

export type DaySlots = { openingHours: TimeRange[] | null; slots: Slot[] }

export type BookingRuleIssue =
  | 'booking_time_invalid'
  | 'booking_not_on_the_hour'
  | 'booking_crosses_midnight'
  | 'booking_too_long'
  | 'booking_not_whole_day'
  | 'booking_outside_opening_hours'
  | 'booking_in_past'
  | 'booking_billing_unit_invalid'

export type BookingRuleInput = {
  startsAt: string
  endsAt: string
  billingUnit: BillingUnit
  opening?: OpeningWindow | null
  now: string
}

export type BookingRuleResult = { ok: true; quantity: number } | { ok: false; issue: BookingRuleIssue }

export function isBookableBillingUnit(value: BillingUnit): value is BookableBillingUnit {
  return value === 'hour' || value === 'day'
}

export function rangesIntersect(left: TimeRange, right: TimeRange): boolean {
  return compareWallClock(left.start, right.end) < 0 && compareWallClock(right.start, left.end) < 0
}

export function dayWindow(date: string, opening?: OpeningWindow | null): TimeRange | null {
  if (!opening) return { start: startOfDay(date), end: endOfDay(date) }
  const opensAt = timeOfDayToMinutes(opening.opensAt)
  const closesAt = timeOfDayToMinutes(opening.closesAt)
  if (opensAt === null || closesAt === null || closesAt <= opensAt || closesAt > MINUTES_PER_DAY) return null
  return { start: atMinuteOfDay(date, opensAt), end: atMinuteOfDay(date, closesAt) }
}

export function subtractRanges(window: TimeRange, blocked: readonly TimeRange[]): TimeRange[] {
  const sorted = blocked
    .filter((range) => rangesIntersect(range, window))
    .slice()
    .sort((left, right) => compareWallClock(left.start, right.start))
  const result: TimeRange[] = []
  let cursor = window.start
  for (const range of sorted) {
    if (compareWallClock(range.start, cursor) > 0) result.push({ start: cursor, end: range.start })
    if (compareWallClock(range.end, cursor) > 0) cursor = range.end
    if (compareWallClock(cursor, window.end) >= 0) return result
  }
  if (compareWallClock(cursor, window.end) < 0) result.push({ start: cursor, end: window.end })
  return result
}

function ceilToHour(value: string): string {
  const minutes = toMinutes(value)
  const remainder = ((minutes % MINUTES_PER_HOUR) + MINUTES_PER_HOUR) % MINUTES_PER_HOUR
  return remainder === 0 ? value : addMinutes(value, MINUTES_PER_HOUR - remainder)
}

function hasEnded(range: TimeRange, now: string | undefined): boolean {
  return now !== undefined && compareWallClock(range.end, now) <= 0
}

function stateOf(range: TimeRange, booked: readonly TimeRange[]): SlotState {
  return booked.some((entry) => rangesIntersect(entry, range)) ? 'booked' : 'free'
}

export function computeDaySlots(input: DaySlotsInput): DaySlots {
  const window = dayWindow(input.date, input.opening)
  const openingHours = input.opening && window ? [window] : input.opening ? [] : null
  if (!window) return { openingHours, slots: [] }
  const booked = input.booked ?? []
  const blocked = input.blocked ?? []
  if (input.billingUnit === 'day') {
    if (blocked.some((range) => rangesIntersect(range, window))) return { openingHours, slots: [] }
    if (hasEnded(window, input.now)) return { openingHours, slots: [] }
    return { openingHours, slots: [{ ...window, state: stateOf(window, booked) }] }
  }
  const slots: Slot[] = []
  for (const open of subtractRanges(window, blocked)) {
    let start = ceilToHour(open.start)
    while (compareWallClock(addMinutes(start, MINUTES_PER_HOUR), open.end) <= 0) {
      const slot = { start, end: addMinutes(start, MINUTES_PER_HOUR) }
      if (!hasEnded(slot, input.now)) slots.push({ ...slot, state: stateOf(slot, booked) })
      start = slot.end
    }
  }
  return { openingHours, slots }
}

export function checkBookingRules(input: BookingRuleInput): BookingRuleResult {
  const { startsAt, endsAt } = input
  if (compareWallClock(endsAt, startsAt) <= 0) return { ok: false, issue: 'booking_time_invalid' }
  if (!isBookableBillingUnit(input.billingUnit)) return { ok: false, issue: 'booking_billing_unit_invalid' }
  if (input.billingUnit === 'hour' && (!isOnTheHour(startsAt) || !isOnTheHour(endsAt))) return { ok: false, issue: 'booking_not_on_the_hour' }
  const date = datePartOf(startsAt)
  if (compareWallClock(endsAt, endOfDay(date)) > 0) return { ok: false, issue: 'booking_crosses_midnight' }
  const window = dayWindow(date, input.opening)
  if (!window || compareWallClock(startsAt, window.start) < 0 || compareWallClock(endsAt, window.end) > 0) {
    return { ok: false, issue: 'booking_outside_opening_hours' }
  }
  let quantity = 1
  if (input.billingUnit === 'hour') {
    quantity = (toMinutes(endsAt) - toMinutes(startsAt)) / MINUTES_PER_HOUR
    if (quantity > MAX_HOURLY_BOOKING_HOURS) return { ok: false, issue: 'booking_too_long' }
  } else if (compareWallClock(startsAt, window.start) !== 0 || compareWallClock(endsAt, window.end) !== 0) {
    return { ok: false, issue: 'booking_not_whole_day' }
  }
  const firstSlotEnd = input.billingUnit === 'hour' ? addMinutes(startsAt, MINUTES_PER_HOUR) : endsAt
  if (compareWallClock(firstSlotEnd, input.now) <= 0) return { ok: false, issue: 'booking_in_past' }
  return { ok: true, quantity }
}
