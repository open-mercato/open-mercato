import { buildOptionFilters } from '../options/route'
import { parseBooleanFlag, sanitizeSearchTerm } from '../helpers'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('catalog options route helpers', () => {
  it('sanitizes search input', () => {
    expect(sanitizeSearchTerm('  code_% ')).toBe('code')
  })

  it('parses boolean switches', () => {
    expect(parseBooleanFlag('true')).toBe(true)
    expect(parseBooleanFlag('false')).toBe(false)
    expect(parseBooleanFlag('maybe')).toBeUndefined()
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
