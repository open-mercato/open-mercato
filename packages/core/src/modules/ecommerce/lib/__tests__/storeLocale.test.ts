import { matchSupportedLocale, parseAcceptLanguage, resolveStoreLocale, sanitizeLocaleTag } from '../storeLocale'

describe('storeLocale', () => {
  it('orders Accept-Language entries by q-value, keeping header order on ties', () => {
    expect(parseAcceptLanguage('de;q=0.5, en-US, fr;q=0.9, pl;q=0.9, *;q=0.1, es;q=0')).toEqual([
      'en-US',
      'fr',
      'pl',
      'de',
    ])
    expect(parseAcceptLanguage(null)).toEqual([])
    expect(parseAcceptLanguage('')).toEqual([])
  })

  it('rejects malformed locale tags', () => {
    expect(sanitizeLocaleTag(' en_US ')).toBe('en-US')
    expect(sanitizeLocaleTag('<script>')).toBeNull()
    expect(sanitizeLocaleTag('x'.repeat(40))).toBeNull()
  })

  it('matches exact, base-language and regional variants against supported locales', () => {
    expect(matchSupportedLocale('DE', ['en', 'de'])).toBe('de')
    expect(matchSupportedLocale('de-AT', ['en', 'de'])).toBe('de')
    expect(matchSupportedLocale('en', ['en-GB', 'de'])).toBe('en-GB')
    expect(matchSupportedLocale('fr', ['en', 'de'])).toBeNull()
  })

  it('falls back to the default locale and nulls a junk requested locale', () => {
    expect(
      resolveStoreLocale({ defaultLocale: 'en', supportedLocales: ['en', 'de'] }, { queryLocale: '%%%' }),
    ).toEqual({ effectiveLocale: 'en', requestedLocale: null })
  })
})
