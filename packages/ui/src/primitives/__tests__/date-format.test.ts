import { pl } from 'date-fns/locale/pl'
import {
  deriveDateDisplayFormat,
  formatDisplayDate,
  formatDisplayDateTime,
  formatWithPublicDateFormat,
  normalizeDateFormatPattern,
  resolveDisplayDateTimeFormat,
  resolvePublicDateFormat,
  resolvePublicDateTimeFormat,
  toDateInputValue,
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
  // Local midnight is `00:00` in every zone, so asserting the time pins the parse without the
  // runner being in a particular zone. A UTC parse reads `02:00` in Europe/Warsaw.
  it('parses a date-only value as local midnight, so the stored day survives the viewer timezone', () => {
    expect(formatDisplayDateTime('2026-07-01')).toBe('2026-07-01 00:00')
    expect(formatDisplayDate('2026-07-01')).toBe('2026-07-01')
  })

  it('defaults to ISO even under a locale whose picker pattern differs', () => {
    expect(deriveDateDisplayFormat('pl')).toBe('d MMM yyyy')
    expect(formatDisplayDate('2026-07-01', pl)).toBe('2026-07-01')
  })

  it('keeps the instant for an offset-carrying value', () => {
    expect(formatDisplayDateTime('2026-07-01T09:30:00Z')).toBe(
      formatWithPublicDateFormat(new Date('2026-07-01T09:30:00Z'), 'yyyy-MM-dd HH:mm'),
    )
  })

  it('accepts a Date as well as a string', () => {
    expect(formatDisplayDate(new Date(2026, 6, 1))).toBe('2026-07-01')
    expect(formatDisplayDateTime(new Date(2026, 6, 1, 9, 30))).toBe('2026-07-01 09:30')
    expect(formatDisplayDate(new Date('not-a-date'))).toBeNull()
  })

  it('tolerates surrounding whitespace, as DataTable does', () => {
    expect(formatDisplayDate(' 2026-07-01 ')).toBe('2026-07-01')
    expect(formatDisplayDate('   ')).toBeNull()
  })

  it('honours the configured env formats', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd.MM.yyyy'
    process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT = 'dd.MM.yyyy HH:mm'
    expect(formatDisplayDate('2026-07-01')).toBe('01.07.2026')
    expect(formatDisplayDateTime('2026-07-01T09:30:00Z')).toMatch(/^01\.07\.2026 \d{2}:\d{2}$/)
  })

  it('returns null on empty or unparsable input', () => {
    expect(formatDisplayDate(null)).toBeNull()
    expect(formatDisplayDate('')).toBeNull()
    expect(formatDisplayDate('not-a-date')).toBeNull()
    expect(formatDisplayDateTime(undefined)).toBeNull()
    expect(formatDisplayDateTime('not-a-date')).toBeNull()
  })
})

describe('resolveDisplayDateTimeFormat', () => {
  // DataTable resolves its cells through this, so the date vars must stay in the chain and stay
  // bare — appending `HH:mm` to a caller's date-only pattern would change every existing table.
  it('falls back through the date vars, used bare', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd.MM.yyyy'
    expect(resolveDisplayDateTimeFormat()).toBe('dd.MM.yyyy')
  })

  it('prefers the date-time vars', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd.MM.yyyy'
    process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT = 'dd.MM.yyyy HH:mm'
    expect(resolveDisplayDateTimeFormat()).toBe('dd.MM.yyyy HH:mm')
  })

  it('ends at ISO with a time', () => {
    expect(resolveDisplayDateTimeFormat()).toBe('yyyy-MM-dd HH:mm')
  })
})

describe('toDateInputValue', () => {
  // `new Date(x).toISOString().slice(0, 10)` yields the UTC day, so a just-past-midnight timestamp
  // east of UTC names the previous day. Asserted against the Date's own local getters rather than a
  // literal, so the contract holds in every runner zone — including UTC, where the two coincide.
  it('yields the local calendar day, not the UTC one', () => {
    const justAfterLocalMidnight = new Date(2026, 6, 2, 0, 30)
    const localDay = `${justAfterLocalMidnight.getFullYear()}-07-0${justAfterLocalMidnight.getDate()}`

    expect(toDateInputValue(justAfterLocalMidnight)).toBe(localDay)
    expect(toDateInputValue(justAfterLocalMidnight)).toBe('2026-07-02')
    expect(toDateInputValue('2026-07-01')).toBe('2026-07-01')
  })

  it('ignores the configured display format, since the input requires yyyy-MM-dd', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd.MM.yyyy'
    expect(toDateInputValue('2026-07-01')).toBe('2026-07-01')
  })

  it('returns null when there is nothing to show', () => {
    expect(toDateInputValue(null)).toBeNull()
    expect(toDateInputValue('not-a-date')).toBeNull()
  })
})
