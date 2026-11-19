/** @jest-environment node */

import type { SalesLineSnapshot } from '../../lib/types'
import { convertLineUnitPricesOnUnitChange } from '../documents'

const MICRO_PRICE = '0.00000001'

function existingLine(unitPrice: string): SalesLineSnapshot {
  return {
    kind: 'product',
    quantity: 1,
    quantityUnit: 'pc',
    currencyCode: 'ETH',
    unitPriceNet: Number(unitPrice),
    unitPriceNetExact: unitPrice,
    unitPriceGross: Number(unitPrice),
    unitPriceGrossExact: unitPrice,
    taxRate: 0,
    uomSnapshot: { toBaseFactor: '1' },
  } as SalesLineSnapshot
}

function convert(existingPrice: string, nextPrice: string) {
  return convertLineUnitPricesOnUnitChange({
    existingSnapshot: existingLine(existingPrice),
    nextQuantityUnit: 'pack',
    nextUomSnapshot: { toBaseFactor: '10' },
    unitPriceNet: Number(nextPrice),
    unitPriceNetExact: nextPrice,
    unitPriceGross: Number(nextPrice),
    unitPriceGrossExact: nextPrice,
    amountDecimalPlaces: 18,
  })
}

describe('convertLineUnitPricesOnUnitChange - order and quote line UOM change', () => {
  it('keeps an explicit micro-price replacement sent with the unit change', () => {
    const result = convert(MICRO_PRICE, '0.00000002')

    expect(result.didConvert).toBe(false)
    expect(result.unitPriceNet).toBe(0.00000002)
    expect(result.unitPriceGross).toBe(0.00000002)
  })

  it('converts an unchanged micro-price by the unit factor', () => {
    const result = convert(MICRO_PRICE, MICRO_PRICE)

    expect(result.didConvert).toBe(true)
    expect(result.unitPriceNetExact).toBe('0.0000001')
    expect(result.unitPriceGrossExact).toBe('0.0000001')
  })

  it('converts an unchanged regular price by the unit factor', () => {
    const result = convert('12.5', '12.5')

    expect(result.didConvert).toBe(true)
    expect(result.unitPriceNetExact).toBe('125')
    expect(result.unitPriceNet).toBe(125)
  })

  it('keeps an explicit regular price replacement', () => {
    const result = convert('12.5', '99')

    expect(result.didConvert).toBe(false)
    expect(result.unitPriceNet).toBe(99)
  })
})
