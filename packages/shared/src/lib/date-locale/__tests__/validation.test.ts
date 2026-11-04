import {
  canonicalizeLocale,
  dateLocaleSettingsInputSchema,
  normalizeDateFormatPattern,
  parseFirstDayOfWeek,
  userTimeZoneSchema,
  validateDateFormatPattern,
} from '../validation'

describe('normalizeDateFormatPattern', () => {
  it('treats blank and locale sentinels as "follow the locale"', () => {
    expect(normalizeDateFormatPattern(undefined)).toBeNull()
    expect(normalizeDateFormatPattern('  ')).toBeNull()
    expect(normalizeDateFormatPattern('auto')).toBeNull()
    expect(normalizeDateFormatPattern('SYSTEM')).toBeNull()
  })

  it('rewrites legacy Moment-style tokens to date-fns tokens', () => {
    expect(normalizeDateFormatPattern('DD.MM.YYYY')).toBe('dd.MM.yyyy')
    expect(normalizeDateFormatPattern('MM/DD/YY')).toBe('MM/dd/yy')
  })

  it('leaves quoted literals untouched while rewriting tokens around them', () => {
    expect(normalizeDateFormatPattern("'DD-YYYY' DD.MM.YYYY")).toBe("'DD-YYYY' dd.MM.yyyy")
    expect(normalizeDateFormatPattern("DD 'o''DD' YYYY")).toBe("dd 'o''DD' yyyy")
  })
})

describe('validateDateFormatPattern', () => {
  it.each(['dd.MM.yyyy', 'MMM d, yyyy', 'h:mm a', "d 'de' MMMM yyyy", 'yyyy-MM-dd HH:mm', "HH'h'mm", "yyyy-MM-dd HH 'h' 'omtz'", 'MMMM do, yyyy', 'Qo yyyy'])(
    'accepts %s',
    (pattern) => {
      expect(validateDateFormatPattern(pattern)).toBeNull()
    },
  )

  it('rejects patterns that are empty, too long or have no token', () => {
    expect(validateDateFormatPattern('')).toBe('empty')
    expect(validateDateFormatPattern('d'.repeat(65))).toBe('tooLong')
    expect(validateDateFormatPattern("'just text'")).toBe('noToken')
  })

  it('rejects unknown or protected tokens', () => {
    expect(validateDateFormatPattern('YYYY-MM-dd')).toBe('invalidToken')
    expect(validateDateFormatPattern('D MMM')).toBe('invalidToken')
    expect(validateDateFormatPattern('dd.MM.yyyy f')).toBe('invalidToken')
  })

  it('accepts the ordinal suffix only where date-fns renders it', () => {
    expect(validateDateFormatPattern('o MMM')).toBe('invalidToken')
    expect(validateDateFormatPattern('ddo MMM')).toBe('invalidToken')
    expect(validateDateFormatPattern('doo MMM')).toBe('invalidToken')
    expect(validateDateFormatPattern('Eo')).toBe('invalidToken')
  })

  it('rejects unsupported characters and unterminated quotes', () => {
    expect(validateDateFormatPattern('dd<MM>yyyy')).toBe('invalidCharacter')
    expect(validateDateFormatPattern("d 'of MMMM")).toBe('unterminatedQuote')
  })
})

describe('canonicalizeLocale', () => {
  it('returns a supported locale tag or null', () => {
    expect(canonicalizeLocale('en-GB')).toBe('en-GB')
    expect(canonicalizeLocale('')).toBeNull()
    expect(canonicalizeLocale('not a locale!')).toBeNull()
  })

  it('normalizes letter case and keeps script and region subtags', () => {
    expect(canonicalizeLocale('en-us')).toBe('en-US')
    expect(canonicalizeLocale('zh-Hant-TW')).toBe('zh-Hant-TW')
  })

  it('rejects tags with Unicode or private-use extensions', () => {
    expect(canonicalizeLocale('th-TH-u-ca-buddhist')).toBeNull()
    expect(canonicalizeLocale('en-US-u-ca-islamic')).toBeNull()
    expect(canonicalizeLocale('de-DE-u-co-phonebk')).toBeNull()
    expect(canonicalizeLocale('en-US-x-acme')).toBeNull()
  })
})

describe('parseFirstDayOfWeek', () => {
  it('accepts digits, numbers and weekday names', () => {
    expect(parseFirstDayOfWeek('1')).toBe(1)
    expect(parseFirstDayOfWeek(0)).toBe(0)
    expect(parseFirstDayOfWeek('Monday')).toBe(1)
    expect(parseFirstDayOfWeek('sat')).toBe(6)
  })

  it('returns null for out-of-range or unknown values', () => {
    expect(parseFirstDayOfWeek('7')).toBeNull()
    expect(parseFirstDayOfWeek('someday')).toBeNull()
    expect(parseFirstDayOfWeek('auto')).toBeNull()
    expect(parseFirstDayOfWeek(undefined)).toBeNull()
  })
})

describe('dateLocaleSettingsInputSchema', () => {
  it('normalizes values and maps auto to null', () => {
    const parsed = dateLocaleSettingsInputSchema.parse({
      locale: 'auto',
      dateFormat: 'DD.MM.YYYY',
      timeFormat: 'HH:mm',
      timeZone: 'europe/warsaw',
      firstDayOfWeek: 1,
    })
    expect(parsed).toEqual({
      locale: null,
      dateFormat: 'dd.MM.yyyy',
      dateTimeFormat: null,
      timeFormat: 'HH:mm',
      timeZone: 'Europe/Warsaw',
      firstDayOfWeek: 1,
    })
  })

  it('reports i18n keys for invalid fields', () => {
    const result = dateLocaleSettingsInputSchema.safeParse({ dateFormat: 'dd<MM', timeZone: 'Mars/Olympus' })
    expect(result.success).toBe(false)
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message)
    expect(messages).toEqual(
      expect.arrayContaining(['configs.dateLocale.errors.pattern.invalidCharacter', 'configs.dateLocale.errors.timeZone']),
    )
  })

  it('reports over-long values with i18n keys, not the default English message', () => {
    const result = dateLocaleSettingsInputSchema.safeParse({
      locale: 'x'.repeat(36),
      timeZone: 'x'.repeat(65),
      dateFormat: 'y'.repeat(65),
    })
    expect(result.success).toBe(false)
    const messages = result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path[0], issue.message]))
    expect(messages).toEqual({
      locale: 'configs.dateLocale.errors.locale',
      timeZone: 'configs.dateLocale.errors.timeZone',
      dateFormat: 'configs.dateLocale.errors.pattern.tooLong',
    })
  })

  it('rejects a locale with a calendar extension', () => {
    const result = dateLocaleSettingsInputSchema.safeParse({ locale: 'th-TH-u-ca-buddhist' })
    expect(result.success).toBe(false)
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toContain('configs.dateLocale.errors.locale')
  })

  it('rejects a UTC offset as a tenant time zone', () => {
    expect(dateLocaleSettingsInputSchema.safeParse({ timeZone: '+01:00' }).success).toBe(false)
  })

  it('rejects unknown keys and out-of-range week starts', () => {
    expect(dateLocaleSettingsInputSchema.safeParse({ unknown: true }).success).toBe(false)
    expect(dateLocaleSettingsInputSchema.safeParse({ firstDayOfWeek: 7 }).success).toBe(false)
  })
})

describe('userTimeZoneSchema', () => {
  it('canonicalizes a zone, keeps null, and leaves undefined untouched', () => {
    expect(userTimeZoneSchema.parse('asia/tokyo')).toBe('Asia/Tokyo')
    expect(userTimeZoneSchema.parse(null)).toBeNull()
    expect(userTimeZoneSchema.parse('')).toBeNull()
    expect(userTimeZoneSchema.parse(undefined)).toBeUndefined()
    expect(userTimeZoneSchema.parse('Asia/Kolkata')).toBe('Asia/Kolkata')
  })

  it('rejects an unknown zone', () => {
    expect(userTimeZoneSchema.safeParse('Mars/Olympus').success).toBe(false)
  })

  it('reports an over-long zone with the translated time zone key', () => {
    const result = userTimeZoneSchema.safeParse('x'.repeat(65))
    expect(result.success).toBe(false)
    expect(new Set(result.success ? [] : result.error.issues.map((issue) => issue.message))).toEqual(
      new Set(['auth.profile.errors.timeZone']),
    )
  })
})
