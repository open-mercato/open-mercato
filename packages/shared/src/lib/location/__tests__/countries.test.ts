import { buildCountryOptions, resolveCountryName } from '../countries'

describe('resolveCountryName', () => {
  it('returns the English name for TR when no locale is given', () => {
    expect(resolveCountryName('TR')).toBe('Turkey')
  })

  it('returns the English name for TR when the English locale is requested', () => {
    expect(resolveCountryName('TR', { locale: 'en' })).toBe('Turkey')
  })

  it('returns the English name for TR for regional English locales', () => {
    expect(resolveCountryName('TR', { locale: 'en-US' })).toBe('Turkey')
    expect(resolveCountryName('TR', { locale: 'en-GB' })).toBe('Turkey')
    expect(resolveCountryName('TR', { locale: 'EN' })).toBe('Turkey')
  })

  it('accepts a lowercase country code', () => {
    expect(resolveCountryName('tr')).toBe('Turkey')
  })

  it('keeps localized names for explicitly requested non-English locales', () => {
    expect(resolveCountryName('TR', { locale: 'pl' })).toBe('Turcja')
    expect(resolveCountryName('TR', { locale: 'de' })).toBe('Türkei')
  })

  it('leaves other countries on their default English names', () => {
    expect(resolveCountryName('PL')).toBe('Poland')
    expect(resolveCountryName('DE')).toBe('Germany')
    expect(resolveCountryName('GB')).toBe('United Kingdom')
  })
})

describe('buildCountryOptions', () => {
  it('labels TR as Turkey in the default English dictionary', () => {
    const options = buildCountryOptions()
    expect(options.find((option) => option.code === 'TR')?.label).toBe('Turkey')
  })

  it('exposes no country labelled with the Türkiye endonym in English', () => {
    const options = buildCountryOptions()
    expect(options.some((option) => option.label === 'Türkiye')).toBe(false)
  })

  it('still labels TR in the requested non-English locale', () => {
    const options = buildCountryOptions({ locale: 'pl' })
    expect(options.find((option) => option.code === 'TR')?.label).toBe('Turcja')
  })

  it('lets transformLabel override the English default', () => {
    const options = buildCountryOptions({
      transformLabel: (code, defaultLabel) => (code === 'TR' ? 'Republic of Türkiye' : defaultLabel),
    })
    expect(options.find((option) => option.code === 'TR')?.label).toBe('Republic of Türkiye')
  })
})
