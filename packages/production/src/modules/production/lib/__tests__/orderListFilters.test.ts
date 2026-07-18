export {}

import { buildOrderListFilters } from '../orderListFilters.js'

describe('buildOrderListFilters', () => {
  it('returns no filters for an empty query', () => {
    expect(buildOrderListFilters({})).toEqual({})
  })

  it('maps sourceType and sourceId to equality filters (the sales-widget lookup shape)', () => {
    expect(buildOrderListFilters({ sourceType: 'sales_order', sourceId: 'order-1' })).toEqual({
      sourceType: { $eq: 'sales_order' },
      sourceId: { $eq: 'order-1' },
    })
  })

  it('maps productId, variantId and status alongside sourceType/sourceId', () => {
    expect(
      buildOrderListFilters({
        productId: 'product-1',
        variantId: 'variant-1',
        status: 'draft',
        sourceType: 'manual',
        sourceId: undefined,
      }),
    ).toEqual({
      productId: { $eq: 'product-1' },
      variantId: { $eq: 'variant-1' },
      status: { $eq: 'draft' },
      sourceType: { $eq: 'manual' },
    })
  })

  it('ignores unrelated query keys (pagination/sort)', () => {
    expect(buildOrderListFilters({ page: 1, pageSize: 50, sortField: 'number' })).toEqual({})
  })
})
