import {
  clearRegisteredTextDirections,
  getLocaleDirection,
  getRegisteredTextDirections,
  isRtlLocale,
  registerTextDirections,
  type TextDirection,
} from '../direction'

const registerUnvalidated = (directions: Record<string, string>) =>
  registerTextDirections(directions as unknown as Record<string, TextDirection>)

describe('getLocaleDirection', () => {
  afterEach(() => {
    clearRegisteredTextDirections()
  })

  it('reports right-to-left for every built-in right-to-left language', () => {
    for (const locale of ['ar', 'dv', 'fa', 'he', 'ps', 'sd', 'ug', 'ur', 'yi']) {
      expect(getLocaleDirection(locale)).toBe('rtl')
    }
  })

  it('reports left-to-right for every locale the platform ships', () => {
    for (const locale of ['en', 'pl', 'es', 'de', 'ko']) {
      expect(getLocaleDirection(locale)).toBe('ltr')
    }
  })

  it('resolves a region subtag through its base language', () => {
    expect(getLocaleDirection('ar-SA')).toBe('rtl')
    expect(getLocaleDirection('ar-EG')).toBe('rtl')
    expect(getLocaleDirection('he-IL')).toBe('rtl')
    expect(getLocaleDirection('en-US')).toBe('ltr')
  })

  it('normalizes case, underscores and surrounding whitespace', () => {
    expect(getLocaleDirection('AR')).toBe('rtl')
    expect(getLocaleDirection('ar_SA')).toBe('rtl')
    expect(getLocaleDirection('  He-IL  ')).toBe('rtl')
  })

  it('falls back to left-to-right for unknown, empty and missing input', () => {
    expect(getLocaleDirection('zz')).toBe('ltr')
    expect(getLocaleDirection('')).toBe('ltr')
    expect(getLocaleDirection('   ')).toBe('ltr')
    expect(getLocaleDirection(null)).toBe('ltr')
    expect(getLocaleDirection(undefined)).toBe('ltr')
  })

  it('keeps script-ambiguous languages out of the built-in table', () => {
    // Both are written in Latin and Arabic script, so the table cannot answer
    // for them; the default stays left-to-right until an app declares otherwise.
    expect(getLocaleDirection('az')).toBe('ltr')
    expect(getLocaleDirection('ku')).toBe('ltr')
  })

  it('answers consistently across repeated calls', () => {
    expect(getLocaleDirection('ar-SA')).toBe('rtl')
    expect(getLocaleDirection('ar-SA')).toBe('rtl')
    expect(getLocaleDirection('en')).toBe('ltr')
    expect(getLocaleDirection('ar-SA')).toBe('rtl')
  })
})

describe('registerTextDirections', () => {
  afterEach(() => {
    clearRegisteredTextDirections()
  })

  it('declares a right-to-left locale the built-in table does not know', () => {
    registerTextDirections({ ckb: 'rtl' })

    expect(getLocaleDirection('ckb')).toBe('rtl')
    expect(getLocaleDirection('ckb-IQ')).toBe('rtl')
  })

  it('overrides the built-in table in both directions', () => {
    registerTextDirections({ ur: 'ltr', az: 'rtl' })

    expect(getLocaleDirection('ur')).toBe('ltr')
    expect(getLocaleDirection('ur-PK')).toBe('ltr')
    expect(getLocaleDirection('az')).toBe('rtl')
  })

  it('prefers a region-specific registration over its base language', () => {
    registerTextDirections({ ar: 'ltr', 'ar-il': 'rtl' })

    expect(getLocaleDirection('ar')).toBe('ltr')
    expect(getLocaleDirection('ar-EG')).toBe('ltr')
    expect(getLocaleDirection('ar-IL')).toBe('rtl')
  })

  it('ignores empty codes and invalid directions instead of throwing', () => {
    registerUnvalidated({ '': 'rtl', '  ': 'rtl', ar: 'sideways', en: 'LTR' })

    expect(getRegisteredTextDirections()).toEqual({})
    expect(getLocaleDirection('ar')).toBe('rtl')
  })

  it('is idempotent', () => {
    registerTextDirections({ ckb: 'rtl' })
    registerTextDirections({ ckb: 'rtl' })

    expect(getRegisteredTextDirections()).toEqual({ ckb: 'rtl' })
  })

  it('drops a cached answer when a registration changes it', () => {
    expect(getLocaleDirection('ur')).toBe('rtl')

    registerTextDirections({ ur: 'ltr' })

    expect(getLocaleDirection('ur')).toBe('ltr')
  })

  it('clears every registration and reports whether anything changed', () => {
    expect(clearRegisteredTextDirections()).toBe(false)

    registerTextDirections({ ckb: 'rtl' })
    expect(clearRegisteredTextDirections()).toBe(true)
    expect(getRegisteredTextDirections()).toEqual({})
    expect(getLocaleDirection('ckb')).toBe('ltr')
  })
})

describe('isRtlLocale', () => {
  afterEach(() => {
    clearRegisteredTextDirections()
  })

  it('answers with the same authority as getLocaleDirection', () => {
    expect(isRtlLocale('ar')).toBe(true)
    expect(isRtlLocale('ar-SA')).toBe(true)
    expect(isRtlLocale('en')).toBe(false)
    expect(isRtlLocale(null)).toBe(false)
    expect(isRtlLocale(undefined)).toBe(false)
  })
})
