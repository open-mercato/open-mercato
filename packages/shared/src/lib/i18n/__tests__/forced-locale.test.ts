import { resolveForcedLocale } from '../locale'

describe('resolveForcedLocale', () => {
  it('returns null when OM_FORCE_LOCALE is unset (default: no forcing)', () => {
    expect(resolveForcedLocale({})).toBeNull()
    expect(resolveForcedLocale({ OM_FORCE_LOCALE: '' })).toBeNull()
    expect(resolveForcedLocale({ OM_FORCE_LOCALE: undefined })).toBeNull()
  })

  it('returns the forced locale when set to a supported value', () => {
    expect(resolveForcedLocale({ OM_FORCE_LOCALE: 'pl' })).toBe('pl')
    expect(resolveForcedLocale({ OM_FORCE_LOCALE: 'de' })).toBe('de')
  })

  it('normalizes region and casing to a supported base locale', () => {
    expect(resolveForcedLocale({ OM_FORCE_LOCALE: 'PL' })).toBe('pl')
    expect(resolveForcedLocale({ OM_FORCE_LOCALE: 'pl-PL' })).toBe('pl')
    expect(resolveForcedLocale({ OM_FORCE_LOCALE: 'en_US' })).toBe('en')
  })

  it('returns null for unsupported locales rather than forcing garbage', () => {
    expect(resolveForcedLocale({ OM_FORCE_LOCALE: 'fr' })).toBeNull()
    expect(resolveForcedLocale({ OM_FORCE_LOCALE: 'not-a-locale' })).toBeNull()
  })
})
