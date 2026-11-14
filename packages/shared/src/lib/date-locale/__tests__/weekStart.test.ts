import { DEFAULT_FIRST_DAY_OF_WEEK, firstDayOfWeekForLocale, resolveFirstDayOfWeek } from '../weekStart'

const WEEK_INFO_KEYS = ['getWeekInfo', 'weekInfo'] as const

function hideIntlWeekInfo(): () => void {
  const prototype = Intl.Locale.prototype
  const saved = WEEK_INFO_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(prototype, key)] as const)
  for (const key of WEEK_INFO_KEYS) {
    Object.defineProperty(prototype, key, { value: undefined, configurable: true, writable: true })
  }
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(prototype, key, descriptor)
      else Reflect.deleteProperty(prototype, key)
    }
  }
}

const CLDR_FIRST_DAY_REGIONS: Record<0 | 5 | 6, string[]> = {
  5: ['MV'],
  6: ['AF', 'BH', 'DJ', 'DZ', 'EG', 'IQ', 'IR', 'JO', 'KW', 'LY', 'OM', 'QA', 'SD', 'SY'],
  0: [
    'AG', 'AS', 'BD', 'BR', 'BS', 'BT', 'BW', 'BZ', 'CA', 'CO', 'DM', 'DO', 'ET', 'GT', 'GU', 'HK', 'HN', 'ID', 'IL', 'IN',
    'IS', 'JM', 'JP', 'KE', 'KH', 'KR', 'LA', 'MH', 'MM', 'MO', 'MT', 'MX', 'MZ', 'NI', 'NP', 'PA', 'PE', 'PH', 'PK', 'PR',
    'PT', 'PY', 'SA', 'SG', 'SV', 'TH', 'TT', 'TW', 'UM', 'US', 'VE', 'VI', 'WS', 'YE', 'ZA', 'ZW',
  ],
}

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

  const hasWeekInfo = typeof (Intl.Locale.prototype as { getWeekInfo?: unknown }).getWeekInfo === 'function'

  ;(hasWeekInfo ? it : it.skip)('falls back to the same CLDR week start the Intl week info reports', () => {
    const tags = Object.values(CLDR_FIRST_DAY_REGIONS).flat().map((region) => `und-${region}`)
    const fromIntl = tags.map((tag) => firstDayOfWeekForLocale(tag))
    const restore = hideIntlWeekInfo()
    let fromFallback: Array<number | null>
    try {
      fromFallback = tags.map((tag) => firstDayOfWeekForLocale(tag))
    } finally {
      restore()
    }
    expect(Object.fromEntries(tags.map((tag, index) => [tag, fromFallback[index]]))).toEqual(
      Object.fromEntries(tags.map((tag, index) => [tag, fromIntl[index]])),
    )
    for (const [day, regions] of Object.entries(CLDR_FIRST_DAY_REGIONS)) {
      for (const region of regions) expect([region, firstDayOfWeekForLocale(`und-${region}`)]).toEqual([region, Number(day)])
    }
  })
})

describe('without Intl week info', () => {
  let restore: () => void = () => {}

  beforeAll(() => {
    restore = hideIntlWeekInfo()
  })

  afterAll(() => restore())

  it('derives the week start from the CLDR region sets', () => {
    expect(firstDayOfWeekForLocale('ar-QA')).toBe(6)
    expect(firstDayOfWeekForLocale('pt-PT')).toBe(0)
    expect(firstDayOfWeekForLocale('dv-MV')).toBe(5)
    expect(firstDayOfWeekForLocale('ar-AE')).toBe(1)
    expect(firstDayOfWeekForLocale('en-US')).toBe(0)
    expect(firstDayOfWeekForLocale('pl-PL')).toBe(1)
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
