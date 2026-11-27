const formatters = new Map<string, Intl.DateTimeFormat>()

function parseWallTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const wall = new Date(`${date}T${time}:00Z`)
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 16) !== `${date}T${time}`) return null
  return wall
}

function calendarTimezoneOffsets(wall: Date, timezone: string): number[] {
  const offsets = new Set<number>()
  for (const hour of [-36, -12, 0, 12, 36]) {
    const sample = new Date(wall.getTime() + hour * 3600000)
    const local = calendarInstantToWallTime(sample, timezone)
    offsets.add(new Date(`${local.date}T${local.time}:00Z`).getTime() - sample.getTime())
  }
  return [...offsets]
}

export function isCalendarTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 120 || /^[+-]/.test(value)) return false
  try {
    formatter(value).format()
    return true
  } catch {
    return false
  }
}

/**
 * IANA zone ids are case-insensitive, so `europe/warsaw` and `Europe/Warsaw` are
 * the same zone and would otherwise be stored — and listed — as two options.
 * Canonicalize on write so the stored value matches the catalog spelling.
 */
export function canonicalCalendarTimezone(value: unknown): string | null {
  if (!isCalendarTimezone(value)) return null
  const resolved = formatter(value).resolvedOptions().timeZone
  return isCalendarTimezone(resolved) ? resolved : value
}

export function defaultCalendarTimezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return isCalendarTimezone(timezone) ? timezone : 'UTC'
}

function formatter(timezone: string): Intl.DateTimeFormat {
  let result = formatters.get(timezone)
  if (!result) {
    result = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!)
    formatters.set(timezone, result)
  }
  return result
}

export function calendarInstantToWallTime(instant: Date, timezone: string): { date: string; time: string } {
  const parts = formatter(timezone).formatToParts(instant)
  const part = (name: string) => parts.find((entry) => entry.type === name)!.value
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

export function calendarWallTimeToInstant(date: string, time: string, timezone: string): Date | null {
  if (!isCalendarTimezone(timezone)) return null
  const wall = parseWallTime(date, time)
  if (!wall) return null
  const candidates = calendarTimezoneOffsets(wall, timezone).map((offset) => new Date(wall.getTime() - offset))
    .filter((instant) => {
      const local = calendarInstantToWallTime(instant, timezone)
      return local.date === date && local.time === time
    }).sort((left, right) => left.getTime() - right.getTime())
  return candidates[0] ?? null
}

export function calendarRecurrenceWallTimeToInstant(date: string, time: string, timezone: string): Date | null {
  const exact = calendarWallTimeToInstant(date, time, timezone)
  if (exact) return exact
  if (!isCalendarTimezone(timezone) || !calendarDayStartInstant(date, timezone)) return null
  const wall = parseWallTime(date, time)
  if (!wall) return null
  const offsets = calendarTimezoneOffsets(wall, timezone)
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
