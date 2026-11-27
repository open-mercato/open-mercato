import { instantToWallTime, isValidTimezone, parseWallTime, resolveBrowserTimezone, wallTimeOffsets, wallTimeToInstant } from '@open-mercato/shared/lib/time/wall-time'

/** @deprecated Use `isValidTimezone` from `@open-mercato/shared/lib/time/wall-time`. */
export const isCalendarTimezone = isValidTimezone

/**
 * IANA zone ids are case-insensitive, so `europe/warsaw` and `Europe/Warsaw` are
 * the same zone and would otherwise be stored — and listed — as two options.
 * Canonicalize on write so the stored value matches the catalog spelling.
 */
export function canonicalCalendarTimezone(value: unknown): string | null {
  if (!isCalendarTimezone(value)) return null
  const resolved = new Intl.DateTimeFormat('en-CA', { timeZone: value }).resolvedOptions().timeZone
  return isCalendarTimezone(resolved) ? resolved : value
}

/** @deprecated Use `resolveBrowserTimezone` from `@open-mercato/shared/lib/time/wall-time`. */
export const defaultCalendarTimezone = resolveBrowserTimezone

/** @deprecated Use `instantToWallTime` from `@open-mercato/shared/lib/time/wall-time`. */
export const calendarInstantToWallTime = instantToWallTime

/** @deprecated Use `wallTimeToInstant` from `@open-mercato/shared/lib/time/wall-time`. */
export const calendarWallTimeToInstant = wallTimeToInstant

export function calendarRecurrenceWallTimeToInstant(date: string, time: string, timezone: string): Date | null {
  const exact = calendarWallTimeToInstant(date, time, timezone)
  if (exact) return exact
  if (!isCalendarTimezone(timezone) || !calendarDayStartInstant(date, timezone)) return null
  const wall = parseWallTime(date, time)
  if (!wall) return null
  const offsets = wallTimeOffsets(wall, timezone)
  if (offsets.length < 2) return null
  return new Date(wall.getTime() - Math.min(...offsets))
}

export function calendarDayStartInstant(date: string, timezone: string): Date | null {
  if (!isCalendarTimezone(timezone) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const anchor = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== date) return null
  const midnight = calendarWallTimeToInstant(date, '00:00', timezone)
  if (midnight) return midnight
  let lower = anchor.getTime() - 36 * 3600000
  let upper = anchor.getTime() + 36 * 3600000
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2)
    if (calendarInstantToWallTime(new Date(middle), timezone).date < date) lower = middle + 1
    else upper = middle
  }
  const boundary = new Date(lower)
  return calendarInstantToWallTime(boundary, timezone).date === date ? boundary : null
}

export function calendarDayEndInstant(date: string, timezone: string): Date | null {
  if (!calendarDayStartInstant(date, timezone)) return null
  const nextDate = new Date(`${date}T00:00:00Z`)
  for (let skippedDays = 0; skippedDays < 3; skippedDays += 1) {
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const nextBoundary = calendarDayStartInstant(nextDate.toISOString().slice(0, 10), timezone)
    if (nextBoundary) return new Date(nextBoundary.getTime() - 1)
  }
  return null
}

export function calendarTimezoneOptions(storedTimezone?: string | null): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  const stored = isCalendarTimezone(storedTimezone) ? [storedTimezone] : []
  return [...new Set(['UTC', defaultCalendarTimezone(), ...stored, ...(intl.supportedValuesOf?.('timeZone') ?? [])])]
}
