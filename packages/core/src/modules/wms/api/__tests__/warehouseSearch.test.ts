import { buildWarehouseListSearchOr } from '../warehouseSearch'

describe('buildWarehouseListSearchOr', () => {
  it('keeps ILIKE on stored country text and maps localized names to ISO codes', () => {
    const orFilters = buildWarehouseListSearchOr('Poland')
    expect(orFilters).toContainEqual({ name: { $ilike: '%Poland%' } })
    expect(orFilters).toContainEqual({ country: { $ilike: '%Poland%' } })
    const countryIn = orFilters.find((filter) => Array.isArray((filter.country as { $in?: string[] } | undefined)?.$in))
    expect((countryIn?.country as { $in: string[] }).$in).toContain('PL')
  })

  it('maps Polish localized labels back to the stored ISO code', () => {
    const orFilters = buildWarehouseListSearchOr('Polska')
    const countryIn = orFilters.find((filter) => Array.isArray((filter.country as { $in?: string[] } | undefined)?.$in))
    expect((countryIn?.country as { $in: string[] }).$in).toContain('PL')
  })

  it('still matches name and city when the term is not a country label', () => {
    const orFilters = buildWarehouseListSearchOr('Gdynia')
    expect(orFilters).toContainEqual({ city: { $ilike: '%Gdynia%' } })
    expect(orFilters).toContainEqual({ name: { $ilike: '%Gdynia%' } })
  })
})
