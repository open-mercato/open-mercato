import {
  clearRegisteredLocales,
  clearServedLocaleRestriction,
  getServedLocaleRestriction,
  getSupportedLocales,
  isSupportedLocale,
  registerLocales,
  restrictServedLocales,
} from '../locale-registry'

describe('restrictServedLocales', () => {
  afterEach(() => {
    clearServedLocaleRestriction()
    clearRegisteredLocales()
  })

  it('narrows the served set to exactly what the app ships', () => {
    registerLocales(['ar'])

    restrictServedLocales(['en', 'ar'])

    expect(getSupportedLocales()).toEqual(['en', 'ar'])
    expect(isSupportedLocale('ar')).toBe(true)
    expect(isSupportedLocale('pl')).toBe(false)
  })

  it('keeps the default locale even when the restriction omits it', () => {
    registerLocales(['ar'])

    restrictServedLocales(['ar'])

    expect(getSupportedLocales()).toEqual(['en', 'ar'])
  })

  it('preserves the order the app declared', () => {
    registerLocales(['ar'])

    restrictServedLocales(['ar', 'en'])

    expect(getSupportedLocales()).toEqual(['ar', 'en'])
  })

  it('normalizes codes and ignores duplicates', () => {
    registerLocales(['ar'])

    restrictServedLocales(['EN', 'ar', 'ar', ''])

    expect(getSupportedLocales()).toEqual(['en', 'ar'])
  })

  it('never serves a locale that does not exist', () => {
    restrictServedLocales(['en', 'zz'])

    expect(getSupportedLocales()).toEqual(['en'])
  })

  it('falls back to the full set when every code is unknown', () => {
    restrictServedLocales(['zz', 'qq'])

    expect(getSupportedLocales()).toEqual(['en', 'pl', 'es', 'de', 'ko'])
  })

  it('drops a locale that was registered but is outside the restriction', () => {
    registerLocales(['ar', 'cs'])

    restrictServedLocales(['en', 'ar'])

    expect(getSupportedLocales()).toEqual(['en', 'ar'])
    expect(isSupportedLocale('cs')).toBe(false)
  })

  it('reports and clears the restriction', () => {
    expect(getServedLocaleRestriction()).toBeNull()
    expect(clearServedLocaleRestriction()).toBe(false)

    restrictServedLocales(['en', 'ar'])

    expect(getServedLocaleRestriction()).toEqual(['en', 'ar'])
    expect(clearServedLocaleRestriction()).toBe(true)
    expect(getSupportedLocales()).toEqual(['en', 'pl', 'es', 'de', 'ko'])
  })

  it('takes effect again after a registration changes the cache', () => {
    registerLocales(['ar'])
    restrictServedLocales(['en', 'ar'])
    expect(getSupportedLocales()).toEqual(['en', 'ar'])

    registerLocales(['cs'])

    expect(getSupportedLocales()).toEqual(['en', 'ar'])
  })
})
