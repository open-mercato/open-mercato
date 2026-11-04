/**
 * Returns the IANA spelling of `value` with the runtime's letter case (for example
 * `europe/warsaw` → `Europe/Warsaw`), or `null` when the runtime cannot resolve it as a named
 * time zone.
 *
 * When `Intl` resolves the name to a different zone ID (ICU reports legacy links such as
 * `Asia/Kolkata` → `Asia/Calcutta`), the caller's spelling is kept: current tzdata builds,
 * including Postgres on Debian trixie, reject many of those legacy names.
 *
 * Offset strings such as `+01:00` are rejected even though recent `Intl` accepts them: Postgres
 * reads `TimeZone=+01:00` as a POSIX spec where positive means WEST of Greenwich, so the same value
 * would mean opposite offsets in the browser and in the database session.
 */
export function canonicalizeTimeZone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[A-Za-z]/.test(trimmed)) return null
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).resolvedOptions().timeZone
    if (!/^[A-Za-z]/.test(resolved)) return null
    return resolved.toLowerCase() === trimmed.toLowerCase() ? resolved : trimmed
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

/**
 * Every IANA zone the runtime supports (or a short common list on runtimes without
 * `supportedValuesOf`), always starting with `UTC`: V8's canonical list omits `UTC` and `Etc/UTC`,
 * and pickers that only accept listed values would otherwise make it unselectable.
 */
export function listSupportedTimeZones(): string[] {
  let zones: string[] = [...FALLBACK_TIME_ZONES]
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof supported === 'function') zones = supported('timeZone')
  } catch {}
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}
