import { sanitizeSearch, parseBoolean, buildOptionFilters } from '../options/route'

describe('catalog options route helpers', () => {
  it('sanitizes search input', () => {
    expect(sanitizeSearch('  code_% ')).toBe('code')
  })

  it('parses boolean switches', () => {
    expect(parseBoolean('true')).toBe(true)
    expect(parseBoolean('false')).toBe(false)
    expect(parseBoolean('maybe')).toBeUndefined()
  })

  it('builds option filters for multiple criteria', async () => {
    const filters = await buildOptionFilters({
      search: '  bundle_% ',
      productId: 'prod-1',
      code: ' SKU ' as any,
      isRequired: 'true',
      isMultiple: 'false',
    } as any)

    expect(filters.$or).toEqual([
      { label: { $ilike: '%bundle%' } },
      { code: { $ilike: '%bundle%' } },
      { description: { $ilike: '%bundle%' } },
    ])
    expect(filters.product_id).toEqual({ $eq: 'prod-1' })
    expect(filters.code).toEqual({ $eq: 'sku' })
    expect(filters.is_required).toBe(true)
    expect(filters.is_multiple).toBe(false)
  })
})
