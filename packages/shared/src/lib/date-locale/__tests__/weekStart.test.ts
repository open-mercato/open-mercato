import { DEFAULT_FIRST_DAY_OF_WEEK, firstDayOfWeekForLocale, resolveFirstDayOfWeek } from '../weekStart'

describe('firstDayOfWeekForLocale', () => {
  it('uses the full regional tag, not just the language', () => {
    expect(firstDayOfWeekForLocale('en-GB')).toBe(1)
    expect(firstDayOfWeekForLocale('en-US')).toBe(0)
    expect(firstDayOfWeekForLocale('pl-PL')).toBe(1)
    expect(firstDayOfWeekForLocale('ar-EG')).toBe(6)
  })

  it('maximizes a bare language tag', () => {
    expect(firstDayOfWeekForLocale('en')).toBe(0)
    expect(firstDayOfWeekForLocale('de')).toBe(1)
  })

  it('returns null for a missing or invalid tag', () => {
    expect(firstDayOfWeekForLocale(null)).toBeNull()
    expect(firstDayOfWeekForLocale('not a locale!')).toBeNull()
  })
})

describe('resolveFirstDayOfWeek', () => {
  it('prefers the configured day', () => {
    expect(resolveFirstDayOfWeek({ firstDayOfWeek: 3, locale: 'en-US' })).toEqual({ day: 3, source: 'setting', locale: null })
  })

  it("uses the formatting locale's week start when no day is configured", () => {
    expect(resolveFirstDayOfWeek({ firstDayOfWeek: null, locale: 'en-US' })).toEqual({ day: 0, source: 'locale', locale: 'en-US' })
    expect(resolveFirstDayOfWeek({ firstDayOfWeek: null, locale: 'en-GB' })).toEqual({ day: 1, source: 'locale', locale: 'en-GB' })
  })

  it('defaults to Monday when neither is set', () => {
    expect(DEFAULT_FIRST_DAY_OF_WEEK).toBe(1)
    expect(resolveFirstDayOfWeek({ firstDayOfWeek: null, locale: null })).toEqual({ day: 1, source: 'default', locale: null })
  })
})
