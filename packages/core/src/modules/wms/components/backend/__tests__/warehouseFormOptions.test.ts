import {
  countryOptionFromStored,
  formatWarehouseCountryLabel,
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

  it('formats warehouse country cells as localized names, not ISO codes', () => {
    expect(formatWarehouseCountryLabel('PL', 'en')).toBe('Poland')
    expect(formatWarehouseCountryLabel('pl', 'en')).toBe('Poland')
    expect(formatWarehouseCountryLabel('Poland', 'en')).toBe('Poland')
    expect(formatWarehouseCountryLabel('', 'en')).toBe('—')
    expect(formatWarehouseCountryLabel(null, 'en')).toBe('—')
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

  it('falls back to UTC and the local zone when supportedValuesOf is unavailable', async () => {
    const intlWithSupported = Intl as typeof Intl & { supportedValuesOf?: (input: 'timeZone') => string[] }
    const original = intlWithSupported.supportedValuesOf
    delete intlWithSupported.supportedValuesOf
    try {
      const options = await loadTimezoneOptions()
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone
      expect(options).toContainEqual({ value: 'UTC', label: 'UTC' })
      expect(options).toContainEqual({ value: local, label: local })
    } finally {
      if (original) intlWithSupported.supportedValuesOf = original
    }
  })

  it('falls back to UTC and the local zone when supportedValuesOf throws', async () => {
    const spy = jest.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new Error('unsupported')
    })
    try {
      const options = await loadTimezoneOptions()
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone
      expect(options).toContainEqual({ value: 'UTC', label: 'UTC' })
      expect(options).toContainEqual({ value: local, label: local })
    } finally {
      spy.mockRestore()
    }
  })
})
