/** @jest-environment node */

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { buildFilters as buildStatementFilters } from '../statements/route'
import { buildFilters as buildProductMappingFilters } from '../product-mappings/route'

const PRODUCT_ID_A = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID_B = '22222222-2222-4222-8222-222222222222'
const ORDER_ID = '33333333-3333-4333-8333-333333333333'

describe('eudr statements list filters', () => {
  it('matches search against title and reference number', () => {
    const filters = buildStatementFilters({ page: 1, pageSize: 50, search: 'DDS-42' })
    expect(filters.$or).toEqual([
      { title: { $ilike: '%DDS-42%' } },
      { reference_number: { $ilike: '%DDS-42%' } },
    ])
  })

  it('escapes ilike wildcards in the search term', () => {
    const filters = buildStatementFilters({ page: 1, pageSize: 50, search: '50%' })
    expect(filters.$or).toEqual([
      { title: { $ilike: '%50\\%%' } },
      { reference_number: { $ilike: '%50\\%%' } },
    ])
  })

  it('filters by orderId on the order_id column', () => {
    const filters = buildStatementFilters({ page: 1, pageSize: 50, orderId: ORDER_ID })
    expect(filters.order_id).toEqual({ $eq: ORDER_ID })
    expect(filters.$or).toBeUndefined()
  })

  it('combines orderId with search', () => {
    const filters = buildStatementFilters({ page: 1, pageSize: 50, orderId: ORDER_ID, search: 'cocoa' })
    expect(filters.order_id).toEqual({ $eq: ORDER_ID })
    expect(filters.$or).toEqual([
      { title: { $ilike: '%cocoa%' } },
      { reference_number: { $ilike: '%cocoa%' } },
    ])
  })

  it('omits order and search filters when neither is provided', () => {
    const filters = buildStatementFilters({ page: 1, pageSize: 50 })
    expect(filters.order_id).toBeUndefined()
    expect(filters.$or).toBeUndefined()
  })
})

describe('eudr product mappings list filters', () => {
  it('filters by a single productId', () => {
    const filters = buildProductMappingFilters({ page: 1, pageSize: 50, productId: PRODUCT_ID_A })
    expect(filters.product_id).toEqual({ $eq: PRODUCT_ID_A })
  })

  it('filters by a comma-separated productId list', () => {
    const filters = buildProductMappingFilters({
      page: 1,
      pageSize: 50,
      productId: `${PRODUCT_ID_A},${PRODUCT_ID_B}`,
    })
    expect(filters.product_id).toEqual({ $in: [PRODUCT_ID_A, PRODUCT_ID_B] })
  })

  it('drops invalid entries and deduplicates the productId list', () => {
    const filters = buildProductMappingFilters({
      page: 1,
      pageSize: 50,
      productId: ` ${PRODUCT_ID_A} ,not-a-uuid,${PRODUCT_ID_A}`,
    })
    expect(filters.product_id).toEqual({ $eq: PRODUCT_ID_A })
  })

  it('applies no product filter when productId has no valid uuid', () => {
    const filters = buildProductMappingFilters({ page: 1, pageSize: 50, productId: 'not-a-uuid' })
    expect(filters.product_id).toBeUndefined()
  })

  it('keeps productId additive with search', () => {
    const filters = buildProductMappingFilters({
      page: 1,
      pageSize: 50,
      productId: PRODUCT_ID_A,
      search: '0901',
    })
    expect(filters.product_id).toEqual({ $eq: PRODUCT_ID_A })
    expect(filters.$or).toEqual([
      { commodity: { $ilike: '%0901%' } },
      { hs_code: { $ilike: '%0901%' } },
      { notes: { $ilike: '%0901%' } },
    ])
  })

  it('extends the search $or with resolved catalog product ids', () => {
    const filters = buildProductMappingFilters(
      { page: 1, pageSize: 50, search: 'arabica' },
      [PRODUCT_ID_A, PRODUCT_ID_B],
    )
    expect(filters.$or).toEqual([
      { commodity: { $ilike: '%arabica%' } },
      { hs_code: { $ilike: '%arabica%' } },
      { notes: { $ilike: '%arabica%' } },
      { product_id: { $in: [PRODUCT_ID_A, PRODUCT_ID_B] } },
    ])
  })

  it('leaves the search $or unchanged when no catalog products match', () => {
    const filters = buildProductMappingFilters({ page: 1, pageSize: 50, search: 'arabica' }, [])
    expect(filters.$or).toEqual([
      { commodity: { $ilike: '%arabica%' } },
      { hs_code: { $ilike: '%arabica%' } },
      { notes: { $ilike: '%arabica%' } },
    ])
  })
})
