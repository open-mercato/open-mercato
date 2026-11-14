/** @jest-environment node */

import { buildUnitPriceReferenceSnapshot } from '../documents'

const product = {
  productId: 'product-1',
  baseUnitCode: 'kg',
  defaultSalesUnit: 'kg',
  unitPriceEnabled: true,
  unitPriceReferenceUnit: 'kg' as const,
  unitPriceBaseQuantity: '1',
  conversionsByUnitKey: {} as never,
}

describe('buildUnitPriceReferenceSnapshot', () => {
  it('rounds the reference price to the fiat amount precision', () => {
    const output = buildUnitPriceReferenceSnapshot({
      product,
      toBaseFactor: 3,
      unitPriceNet: '10',
      unitPriceGross: '12.3',
    })

    expect(output).toMatchObject({ netPerReference: '3.3333', grossPerReference: '4.1' })
  })

  it('keeps the exact unit price digits and rounds to the line amount precision', () => {
    const output = buildUnitPriceReferenceSnapshot({
      product: { ...product, unitPriceBaseQuantity: '100' },
      toBaseFactor: 0.5,
      unitPriceNet: '0.000000000000000001',
      unitPriceGross: '1.000000000000000003',
      amountDecimalPlaces: 18,
    })

    expect(output).toMatchObject({
      baseQuantity: '100',
      netPerReference: '0.0000000000000002',
      grossPerReference: '200.0000000000000006',
    })
  })

  it('skips a price that is not set', () => {
    const output = buildUnitPriceReferenceSnapshot({
      product,
      toBaseFactor: 1,
      unitPriceNet: '5',
      unitPriceGross: null,
    })

    expect(output).toEqual({
      enabled: true,
      referenceUnitCode: 'kg',
      baseQuantity: '1',
      netPerReference: '5',
    })
  })
})
