export const SALES_RECURRENCE_FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const
export type SalesRecurrenceFrequency = (typeof SALES_RECURRENCE_FREQUENCIES)[number]
export const SALES_ORDER_RECURRENCE_STATUSES = ['scheduled', 'active', 'cancelling', 'completed', 'cancelled'] as const
export type SalesOrderRecurrenceStatus = (typeof SALES_ORDER_RECURRENCE_STATUSES)[number]
export const SALES_RECURRING_CANCEL_SETTLEMENTS = ['prorate', 'credit_full', 'keep'] as const
export type SalesRecurringCancelSettlement = (typeof SALES_RECURRING_CANCEL_SETTLEMENTS)[number]

export type RecurrenceSchedule = {
  frequency: SalesRecurrenceFrequency
  startsOn: string
  anchorDay?: number | null
  periodCount?: number | null
}

export type PeriodBounds = { start: string; end: string }

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000
const FACTOR_SCALE = 10_000

const MONTHS_PER_PERIOD: Record<Exclude<SalesRecurrenceFrequency, 'weekly'>, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
}

type CalendarDate = { year: number; month: number; day: number }

function parseIsoDate(value: string): CalendarDate {
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) throw new Error(`[internal] Invalid ISO date: ${value}`)
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) {
    throw new Error(`[internal] Invalid ISO date: ${value}`)
  }
  return date
}

function formatIsoDate(date: CalendarDate): string {
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return `${String(date.year).padStart(4, '0')}-${month}-${day}`
}

function toEpochDay(value: string): number {
  const { year, month, day } = parseIsoDate(value)
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

function fromEpochDay(epochDay: number): string {
  const date = new Date(epochDay * MS_PER_DAY)
  return formatIsoDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() })
}

export function isIsoDate(value: string): boolean {
  try {
    parseIsoDate(value)
    return true
  } catch {
    return false
  }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addDays(value: string, days: number): string {
  return fromEpochDay(toEpochDay(value) + days)
}

export function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from)
}

export function compareIsoDates(left: string, right: string): number {
  return Math.sign(daysBetween(right, left))
}

/** The deployment's local calendar date (`TZ`), never the UTC date of `toISOString()`. */
export function localToday(now: Date = new Date()): string {
  return formatIsoDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() })
}

export function resolveAnchorDay(schedule: Pick<RecurrenceSchedule, 'startsOn' | 'anchorDay'>): number {
  return schedule.anchorDay ?? parseIsoDate(schedule.startsOn).day
}

/**
 * An explicit anchor day must land on `startsOn` once clamped to the start month,
 * so the first anniversary is always the start date (anchor 31 may start on 30 Apr).
 */
export function isAnchorDayValid(schedule: Pick<RecurrenceSchedule, 'frequency' | 'startsOn' | 'anchorDay'>): boolean {
  if (schedule.anchorDay === null || schedule.anchorDay === undefined) return true
  if (schedule.frequency === 'weekly') return false
  const start = parseIsoDate(schedule.startsOn)
  return Math.min(schedule.anchorDay, daysInMonth(start.year, start.month)) === start.day
}

/** Start date of period `index` (0-based); month-end and 29 Feb anchors clamp to shorter months. */
export function anniversary(schedule: RecurrenceSchedule, index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error(`[internal] Invalid period index: ${index}`)
  if (schedule.frequency === 'weekly') return addDays(schedule.startsOn, index * 7)
  const start = parseIsoDate(schedule.startsOn)
  const monthOffset = start.month - 1 + index * MONTHS_PER_PERIOD[schedule.frequency]
  const year = start.year + Math.floor(monthOffset / 12)
  const month = (monthOffset % 12) + 1
  const day = Math.min(resolveAnchorDay(schedule), daysInMonth(year, month))
  return formatIsoDate({ year, month, day })
}

export function periodBounds(schedule: RecurrenceSchedule, index: number): PeriodBounds {
  return { start: anniversary(schedule, index), end: addDays(anniversary(schedule, index + 1), -1) }
}

/** Last day served by a finite recurrence; always the end of a whole period. `null` when open-ended. */
export function endsOn(schedule: RecurrenceSchedule): string | null {
  if (schedule.periodCount === null || schedule.periodCount === undefined) return null
  return addDays(anniversary(schedule, schedule.periodCount), -1)
}

/**
 * Share of a period served before `effectiveOn` (the first day no longer served),
 * as days used ÷ days in the period, rounded half-up to 4 decimals. Clamped to [0, 1].
 */
export function prorationFactor(effectiveOn: string, period: PeriodBounds): string {
  const daysInPeriod = daysBetween(period.start, period.end) + 1
  const daysUsed = Math.min(Math.max(daysBetween(period.start, effectiveOn), 0), daysInPeriod)
  const scaled = Math.floor((daysUsed * FACTOR_SCALE * 2 + daysInPeriod) / (daysInPeriod * 2))
  const whole = Math.floor(scaled / FACTOR_SCALE)
  const fraction = String(scaled % FACTOR_SCALE).padStart(4, '0')
  return `${whole}.${fraction}`
}
