import { buildVariantFilters } from '../variants/route'
import { sanitizeSearchTerm } from '../helpers'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('catalog variants route helpers', () => {
  it('sanitizes search terms consistently', () => {
    expect(sanitizeSearchTerm('  bag_% ')).toBe('bag')
  })

  it('builds filters for combinations of query params', async () => {
    const filters = await buildVariantFilters({
      search: '  hat_% ',
      productId: 'prod-1',
      sku: ' SKU-1 ',
      isActive: 'false',
      isDefault: 'true',
    } as any)

    expect(filters.$or).toEqual([
      { name: { $ilike: '%hat%' } },
      { sku: { $ilike: '%hat%' } },
      { barcode: { $ilike: '%hat%' } },
    ])
    expect(filters.product_id).toEqual({ $eq: 'prod-1' })
    expect(filters.sku).toEqual({ $eq: 'SKU-1' })
    expect(filters.is_active).toBe(false)
    expect(filters.is_default).toBe(true)
  })
})
