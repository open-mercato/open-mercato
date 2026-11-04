import { calendarDayInTimeZone } from '@open-mercato/shared/lib/date/timezone'

export function getMondayUtc(input: Date): Date {
  const d = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()))
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d
}

export function addUtcDays(input: Date, days: number): Date {
  const d = new Date(input)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export function getFirstDayOfMonthUtc(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1))
}

export function getFirstDayOfNextMonthUtc(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth() + 1, 1))
}

export function getLastNWeekStarts(n: number, now: Date = new Date()): Date[] {
  const currentMonday = getMondayUtc(now)
  const starts: Date[] = []
  for (let i = n - 1; i >= 0; i--) {
    starts.push(addUtcDays(currentMonday, -i * 7))
  }
  return starts
}

export function toDateOnlyString(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export type MyWorkPeriods = {
  todayDate: string
  weekStart: Date
  weekEnd: Date
  monthStart: Date
  nextMonthStart: Date
}

/**
 * The my-work dashboard periods for `now`: today named in `timeZone` (the viewer's display zone;
 * UTC when none is configured, the long-standing behavior), and the Monday-based week and the
 * month that contain that day, as UTC-midnight date-only values. The week stays Monday-based even
 * when the tenant's first day of week differs: it must match the timesheet week period and the
 * project KPIs, which are Monday-based by design.
 */
export function resolveMyWorkPeriods(now: Date, timeZone: string | null | undefined): MyWorkPeriods {
  const todayDate = calendarDayInTimeZone(now, timeZone ?? 'UTC')
  const today = new Date(`${todayDate}T00:00:00.000Z`)
  const weekStart = getMondayUtc(today)
  return {
    todayDate,
    weekStart,
    weekEnd: addUtcDays(weekStart, 6),
    monthStart: getFirstDayOfMonthUtc(today),
    nextMonthStart: getFirstDayOfNextMonthUtc(today),
  }
}
