import { decodeProductUseIntent, encodeProductUseIntent } from '../lib/productUseIntent'

describe('product use intent', () => {
  it('round-trips and normalises the billing unit', () => {
    const encoded = encodeProductUseIntent({ sourceEntityId: 'catalog:catalog_product', use: 'leasable', billingUnit: 'hour' })
    expect(decodeProductUseIntent(encoded)).toEqual({ sourceEntityId: 'catalog:catalog_product', use: 'leasable', billingUnit: 'month' })
  })

  it('clears the billing unit with the use and ignores garbage', () => {
    const encoded = encodeProductUseIntent({ sourceEntityId: 'x', use: null, billingUnit: 'day' })
    expect(decodeProductUseIntent(encoded)?.billingUnit).toBeNull()
    expect(decodeProductUseIntent('%%%')).toBeNull()
    expect(decodeProductUseIntent(undefined)).toBeNull()
  })
})
