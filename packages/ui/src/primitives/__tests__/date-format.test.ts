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
  toUtcDateInputValue,
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
    expect(formatDisplayDateTime('2026-07-01', 'pl')).toBe('1 lip 2026, 00:00')
    expect(formatDisplayDate('2026-07-01', 'pl')).toBe('1 lip 2026')
  })

  // With no env override the display pattern is the locale's own, and the month name comes from
  // the resolved date-fns locale — so this agrees with `ReturnsSection` / `ShipmentsSection`,
  // which render `9 cze 2026` beside it. A bare string locale is enough; callers hold one.
  // Formatting through `Intl` rather than a derived pattern, because a two-branch "day first or
  // not" heuristic cannot express either of these: `ko` writes the year first, `de` is numeric and
  // dotted. Both are locales this repo ships, and this path feeds every backend table.
  it.each([
    ['en', 'Jul 1, 2026'],
    ['pl', '1 lip 2026'],
    ['es', '1 jul 2026'],
    ['de', '01.07.2026'],
    ['ko', '2026. 7. 1.'],
  ])('renders %s correctly, including the locales a pattern heuristic gets wrong', (locale, expected) => {
    expect(formatDisplayDate('2026-07-01', locale)).toBe(expected)
  })

  // `en` is `defaultLocale` (`packages/shared/src/lib/i18n/config.ts`), so this is what most
  // deployments actually render. `timeStyle: 'short'` moves it from the locale-neutral
  // `2026-07-01 00:00` to a 12-hour clock — the widest-reach consequence of this change, and the
  // one a reader is most likely to mistake for a bug. Pinned so it is a decision, not a side effect.
  // Operators who want the old shape set `NEXT_PUBLIC_OM_DATE_TIME_FORMAT=yyyy-MM-dd HH:mm`.
  it('renders the default locale on a 12-hour clock, not the previous ISO-like shape', () => {
    expect(formatDisplayDateTime('2026-07-01', 'en')).toBe('Jul 1, 2026, 12:00 AM')
    expect(formatDisplayDate('2026-07-01', 'en')).toBe('Jul 1, 2026')
  })

  it('lets an env pattern override the locale, so a deployment can pin one shape', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'yyyy-MM-dd'
    expect(formatDisplayDate('2026-07-01', 'ko')).toBe('2026-07-01')
    expect(formatDisplayDate('2026-07-01', 'de')).toBe('2026-07-01')
  })

  it('keeps the instant for an offset-carrying value', () => {
    expect(formatDisplayDateTime('2026-07-01T09:30:00Z', 'pl')).toBe(
      new Intl.DateTimeFormat('pl', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date('2026-07-01T09:30:00Z'),
      ),
    )
  })

  it('accepts a Date as well as a string', () => {
    expect(formatDisplayDate(new Date(2026, 6, 1), 'pl')).toBe('1 lip 2026')
    expect(formatDisplayDateTime(new Date(2026, 6, 1, 9, 30), 'pl')).toBe('1 lip 2026, 09:30')
    expect(formatDisplayDate(new Date('not-a-date'), 'pl')).toBeNull()
  })

  it('tolerates surrounding whitespace, as DataTable does', () => {
    expect(formatDisplayDate(' 2026-07-01 ', 'pl')).toBe('1 lip 2026')
    expect(formatDisplayDate('   ', 'pl')).toBeNull()
  })

  it('honours the configured env formats', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd.MM.yyyy'
    process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT = 'dd.MM.yyyy HH:mm'
    expect(formatDisplayDate('2026-07-01')).toBe('01.07.2026')
    // Compared against the formatter rather than a literal: `09:30Z` falls on 30 June at UTC-10
    // and further west, so a hardcoded `01.07.2026` would fail there.
    expect(formatDisplayDateTime('2026-07-01T09:30:00Z')).toBe(
      formatWithPublicDateFormat(new Date('2026-07-01T09:30:00Z'), 'dd.MM.yyyy HH:mm'),
    )
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

  it('reports no override when nothing is configured, so the caller falls to Intl', () => {
    expect(resolveDisplayDateTimeFormat()).toBeNull()
  })
})

describe('toDateInputValue', () => {
  // `new Date(x).toISOString().slice(0, 10)` yields the UTC day, so a just-past-midnight timestamp
  // east of UTC names the previous day. Asserted against the Date's own local getters rather than a
  // literal, so the contract holds in every runner zone — including UTC, where the two coincide.
  it('yields the local calendar day, not the UTC one', () => {
    // Constructed from local components, so it is local July 2 in every zone — the
    // zone-independence is in the construction, not in the assertion.
    const justAfterLocalMidnight = new Date(2026, 6, 2, 0, 30)

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

// `toDateInputValue` and `toUtcDateInputValue` differ by exactly one day for half the planet, so
// which one a field gets is a correctness question, not a style one.
//
// In a UTC runner the two are the same function, so these cases cannot fail there — and CI runs
// in UTC. That is why `yarn test` runs this file a second time under `TZ=America/New_York` (the
// `test:tz` script): the frame decision is enforced by the same command everywhere, rather than
// waiting on a runner that happens to sit west of UTC. Setting `process.env.TZ` inside the file
// does not work — Node resolves the zone once at startup.
describe('toUtcDateInputValue', () => {
  // The shape that actually arrives from the API for a date-only column: the editor submits a bare
  // `yyyy-MM-dd`, `z.coerce.date()` stores UTC midnight, the route returns it with a `Z`.
  const STORED_DATE_ONLY = '2026-07-01T00:00:00.000Z'

  it('round-trips a date-only value stored as UTC midnight', () => {
    expect(toUtcDateInputValue(STORED_DATE_ONLY)).toBe('2026-07-01')
  })

  it('reads the frame the value was written in, whatever the viewer zone', () => {
    expect(toUtcDateInputValue(STORED_DATE_ONLY)).toBe(
      new Date(STORED_DATE_ONLY).toISOString().slice(0, 10),
    )
  })

  // A bare day names itself. Parsing it into an instant first — by either reading — moves it in
  // some zone, which is how the first version of this helper was wrong.
  it('passes a bare date-only string through untouched', () => {
    expect(toUtcDateInputValue('2026-07-01')).toBe('2026-07-01')
    expect(toUtcDateInputValue(' 2026-07-01 ')).toBe('2026-07-01')
  })

  it('returns null when there is nothing to show', () => {
    expect(toUtcDateInputValue(null)).toBeNull()
    expect(toUtcDateInputValue('not-a-date')).toBeNull()
  })
})

// A row that renders a stored date-only column and also seeds an editor from it must name one day.
// `PaymentsSection` renders `receivedAt` while its Edit dialog seeds from `receivedAt.slice(0, 10)`
// — the UTC day — so the rendered day has to be derived the same way, or one row contradicts itself.
describe('rendering a stored date-only column', () => {
  const STORED = '2026-07-01T00:00:00.000Z'

  it('agrees with an editor that seeds from the UTC day', () => {
    expect(toUtcDateInputValue(STORED)).toBe(STORED.slice(0, 10))
    expect(formatDisplayDate(toUtcDateInputValue(STORED), 'pl')).toBe('1 lip 2026')
  })

  it('still honours the configured display format', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd.MM.yyyy'
    expect(formatDisplayDate(toUtcDateInputValue(STORED))).toBe('01.07.2026')
  })

  it('renders nothing when the column is empty', () => {
    expect(formatDisplayDate(toUtcDateInputValue(null))).toBeNull()
  })
})
