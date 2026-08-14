import {
  deriveDateDisplayFormat,
  formatDisplayDate,
  formatDisplayDateTime,
  formatWithPublicDateFormat,
  normalizeDateFormatPattern,
  resolvePublicDateFormat,
  resolvePublicDateTimeFormat,
} from '../date-format'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('date display format helpers', () => {
  it('derives a system-style fallback from the locale family', () => {
    expect(deriveDateDisplayFormat('en')).toBe('MMM d, yyyy')
    expect(deriveDateDisplayFormat('pl')).toBe('d MMM yyyy')
  })

  it('normalizes legacy uppercase tokens for date-fns', () => {
    expect(normalizeDateFormatPattern('YYYY-MM-DD HH:mm')).toBe('yyyy-MM-dd HH:mm')
  })

  it('treats system-like env values as unset', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'system'
    expect(resolvePublicDateFormat('en')).toBe('MMM d, yyyy')
  })

  it('uses OM-prefixed env formats before legacy env formats', () => {
    process.env.NEXT_PUBLIC_DATE_FORMAT = 'YYYY/MM/DD'
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd.MM.yyyy'
    process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT = 'dd.MM.yyyy HH:mm'

    expect(resolvePublicDateFormat('en')).toBe('dd.MM.yyyy')
    expect(resolvePublicDateTimeFormat('en')).toBe('dd.MM.yyyy HH:mm')
  })

  it('formats with normalized date-fns patterns', () => {
    const value = formatWithPublicDateFormat(new Date(2026, 4, 9, 10, 30), 'yyyy-MM-dd HH:mm')
    expect(value).toBe('2026-05-09 10:30')
  })
})

describe('display value helpers', () => {
  // Bug caught: `new Date('2026-07-01')` reads a bare date as UTC *midnight*, so once `format`
  // renders it in the viewer's zone the stored calendar day slips — one day back west of UTC, and
  // an invented time everywhere else. Asserting the whole timestamp pins the parse without needing
  // the runner in a particular zone: local midnight is `00:00` in every zone, whereas the UTC-parse
  // shows `02:00` in Europe/Warsaw and `2026-06-30 17:00` in America/Los_Angeles.
  // (In a UTC runner the two agree, so this case only bites off-UTC — which is every dev machine.)
  it('parses a date-only value as local midnight, so the stored day survives the viewer timezone', () => {
    expect(formatDisplayDateTime('2026-07-01')).toBe('2026-07-01 00:00')
    expect(formatDisplayDate('2026-07-01')).toBe('2026-07-01')
  })

  // Bug caught: routing these through `resolvePublicDateFormat` would emit `1 Jul 2026` on a Polish
  // page, disagreeing with the DataTable cells on the same screen, which default to ISO.
  it('defaults to ISO rather than the locale-derived picker pattern', () => {
    expect(formatDisplayDate('2026-07-01')).toBe('2026-07-01')
    expect(deriveDateDisplayFormat('pl')).toBe('d MMM yyyy') // the pattern deliberately NOT used here
  })

  // Bug caught: parsing an offset-carrying timestamp as bare local parts would shift it by the
  // local UTC offset, silently moving a real instant.
  it('keeps the instant for an offset-carrying value', () => {
    expect(formatDisplayDateTime('2026-07-01T09:30:00Z')).toBe(
      formatWithPublicDateFormat(new Date('2026-07-01T09:30:00Z'), 'yyyy-MM-dd HH:mm'),
    )
  })

  // Bug caught: hardcoding the pattern instead of running the env chain silently ignores an app's
  // configured date format — the original complaint these helpers exist to fix.
  it('honours the configured env formats', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd.MM.yyyy'
    process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT = 'dd.MM.yyyy HH:mm'
    expect(formatDisplayDate('2026-07-01')).toBe('01.07.2026')
    expect(formatDisplayDateTime('2026-07-01T09:30:00Z')).toMatch(/^01\.07\.2026 \d{2}:\d{2}$/)
  })

  // Bug caught: returning the string `Invalid Date` puts that literal into the UI where the
  // caller's empty-state label belongs.
  it('returns null on empty or unparsable input', () => {
    expect(formatDisplayDate(null)).toBeNull()
    expect(formatDisplayDate('')).toBeNull()
    expect(formatDisplayDate('not-a-date')).toBeNull()
    expect(formatDisplayDateTime(undefined)).toBeNull()
    expect(formatDisplayDateTime('not-a-date')).toBeNull()
  })
})
