/**
 * Returns the current IANA name of the zone `value` names, or `null` when the runtime cannot
 * resolve it as a named time zone: the letter case is normalized (`europe/warsaw` →
 * `Europe/Warsaw`), and an alias is stored as the zone it links to (`US/Eastern` →
 * `America/New_York`, `GMT` → `UTC`).
 *
 * ICU still resolves some zones to names tzdata has since renamed (`Asia/Kolkata` →
 * `Asia/Calcutta`); those come back under the current name. Current tzdata builds, including
 * Postgres on Debian trixie, ship the old names and aliases only in an optional package, so
 * storing them could make the database reject the zone.
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
    return CURRENT_NAMES_OF_ICU_LEGACY_ZONES[resolved] ?? resolved
  } catch {
    return null
  }
}

/**
 * Zones ICU still lists under the name tzdata has since renamed. Current tzdata builds keep the old
 * names only in the optional `backward` file (Debian trixie ships it separately), so pickers offer
 * the current name instead.
 */
const CURRENT_NAMES_OF_ICU_LEGACY_ZONES: Record<string, string> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Coral_Harbour': 'America/Atikokan',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Louisville': 'America/Kentucky/Louisville',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
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
 *
 * Renamed zones are listed under their current name (`Asia/Kolkata`, not ICU's `Asia/Calcutta`).
 * Pass the currently stored value as `include` so a picker can still show a zone the list lacks.
 */
export function listSupportedTimeZones(include?: string | null): string[] {
  let zones: string[] = [...FALLBACK_TIME_ZONES]
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    if (typeof supported === 'function') zones = supported('timeZone')
  } catch {}
  const named = zones.map((zone) => CURRENT_NAMES_OF_ICU_LEGACY_ZONES[zone] ?? zone)
  const extra = include?.trim()
  if (extra && !named.includes(extra)) named.push(extra)
  const sorted = [...new Set(named)]
    .filter((zone) => zone !== 'UTC')
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  return ['UTC', ...sorted]
}
