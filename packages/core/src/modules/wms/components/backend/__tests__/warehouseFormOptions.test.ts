import {
  countryOptionFromStored,
  loadCountryOptions,
  loadTimezoneOptions,
} from '../warehouseFormOptions'

describe('warehouseFormOptions', () => {
  it('resolves stored ISO country codes to localized labels', () => {
    expect(countryOptionFromStored('pl', 'en')).toEqual({ value: 'PL', label: 'Poland' })
  })

  it('keeps legacy free-text country values selectable', () => {
    expect(countryOptionFromStored('Poland', 'en')).toEqual({ value: 'Poland', label: 'Poland' })
  })

  it('filters countries by ISO code and name', async () => {
    const byCode = await loadCountryOptions('PL', 'en')
    expect(byCode.some((option) => option.value === 'PL' && option.label === 'Poland')).toBe(true)

    const byName = await loadCountryOptions('Poland', 'en')
    expect(byName.some((option) => option.value === 'PL')).toBe(true)
  })

  it('caps country options at 100', async () => {
    const options = await loadCountryOptions(undefined, 'en')
    expect(options.length).toBeLessThanOrEqual(100)
    expect(options.some((option) => option.value === 'PL')).toBe(true)
  })

  it('includes UTC even when Intl.supportedValuesOf does not list it', async () => {
    const options = await loadTimezoneOptions('utc')
    expect(options).toContainEqual({ value: 'UTC', label: 'UTC' })
  })

  it('filters timezones by query so Europe/Warsaw is reachable', async () => {
    const options = await loadTimezoneOptions('Europe/Warsaw')
    expect(options).toContainEqual({ value: 'Europe/Warsaw', label: 'Europe/Warsaw' })
  })
})
