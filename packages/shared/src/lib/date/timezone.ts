/**
 * Returns the canonical IANA spelling of `value` (for example `europe/warsaw` → `Europe/Warsaw`),
 * or `null` when the runtime cannot resolve it as a time zone.
 */
export function canonicalizeTimeZone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

export function isValidTimeZone(value: string | null | undefined): value is string {
  return canonicalizeTimeZone(value) !== null
}

const calendarDayFormatterCache = new Map<string, Intl.DateTimeFormat>()

/**
 * The calendar day (`yyyy-MM-dd`) of `date` in `timeZone`, or in the runtime zone when none is
 * given or it is unknown. Server code uses it to name "today" for a tenant instead of the UTC day.
 */
export function calendarDayInTimeZone(date: Date, timeZone?: string | null): string {
  const zone = canonicalizeTimeZone(timeZone) ?? undefined
  const key = zone ?? ''
  let formatter = calendarDayFormatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    calendarDayFormatterCache.set(key, formatter)
  }
  const parts = formatter.formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${read('year')}-${read('month')}-${read('day')}`
}

const FALLBACK_TIME_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Warsaw',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Asia/Seoul',
]

/** Every IANA zone the runtime supports, or a short common list on runtimes without `supportedValuesOf`. */
export function listSupportedTimeZones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof supported === 'function') return supported('timeZone')
  } catch {}
  return [...FALLBACK_TIME_ZONES]
}
