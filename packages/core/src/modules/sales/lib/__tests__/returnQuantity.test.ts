import { computeAvailableReturnQuantity, sumShippedQuantityByLine } from '../returnQuantity'

describe('computeAvailableReturnQuantity (issue #1540)', () => {
  it('returns 0 when nothing remains', () => {
    expect(computeAvailableReturnQuantity({ quantity: 1, returnedQuantity: 1 })).toBe(0)
  })

  it('returns floor of difference for clean integers', () => {
    expect(computeAvailableReturnQuantity({ quantity: 5, returnedQuantity: 2 })).toBe(3)
  })

  it('avoids float precision artifacts (1 - 0.9 must not show 0.0999...)', () => {
    expect(computeAvailableReturnQuantity({ quantity: 1, returnedQuantity: 0.9 })).toBe(0)
  })

  it('floors legacy fractional returnedQuantity to a whole-number remainder', () => {
    expect(computeAvailableReturnQuantity({ quantity: 5, returnedQuantity: 0.9 })).toBe(4)
  })

  it('returns 0 when result would be negative', () => {
    expect(computeAvailableReturnQuantity({ quantity: 1, returnedQuantity: 5 })).toBe(0)
  })

  it('returns 0 for non-finite inputs', () => {
    expect(computeAvailableReturnQuantity({ quantity: Number.NaN, returnedQuantity: 0 })).toBe(0)
    expect(computeAvailableReturnQuantity({ quantity: 1, returnedQuantity: Number.POSITIVE_INFINITY })).toBe(0)
  })
})

describe('computeAvailableReturnQuantity shipped cap (issue #3034)', () => {
  it('caps availability at shipped quantity when nothing has shipped', () => {
    expect(computeAvailableReturnQuantity({ quantity: 3, returnedQuantity: 0, shippedQuantity: 0 })).toBe(0)
  })

  it('caps availability at shipped quantity below the ordered quantity', () => {
    expect(computeAvailableReturnQuantity({ quantity: 3, returnedQuantity: 0, shippedQuantity: 2 })).toBe(2)
  })

  it('subtracts already-returned quantity from the shipped cap', () => {
    expect(computeAvailableReturnQuantity({ quantity: 3, returnedQuantity: 1, shippedQuantity: 2 })).toBe(1)
  })

  it('never exceeds ordered quantity even when more was shipped', () => {
    expect(computeAvailableReturnQuantity({ quantity: 2, returnedQuantity: 0, shippedQuantity: 5 })).toBe(2)
  })

  it('falls back to ordered quantity when shipped quantity is omitted (legacy callers)', () => {
    expect(computeAvailableReturnQuantity({ quantity: 4, returnedQuantity: 1 })).toBe(3)
  })

  it('ignores a non-finite shipped quantity and falls back to ordered quantity', () => {
    expect(computeAvailableReturnQuantity({ quantity: 4, returnedQuantity: 0, shippedQuantity: Number.NaN })).toBe(4)
  })
})

describe('sumShippedQuantityByLine (issue #3034 UI parity)', () => {
  it('returns an empty map for missing or empty shipment lists', () => {
    expect(sumShippedQuantityByLine(null).size).toBe(0)
    expect(sumShippedQuantityByLine(undefined).size).toBe(0)
    expect(sumShippedQuantityByLine([]).size).toBe(0)
  })

  it('sums shipped quantities per order line across shipments', () => {
    const result = sumShippedQuantityByLine([
      { items: [{ orderLineId: 'line-a', quantity: 2 }, { orderLineId: 'line-b', quantity: 1 }] },
      { items: [{ orderLineId: 'line-a', quantity: 3 }] },
    ])
    expect(result.get('line-a')).toBe(5)
    expect(result.get('line-b')).toBe(1)
  })

  it('accepts snake_case order line ids and string quantities', () => {
    const result = sumShippedQuantityByLine([
      { items: [{ order_line_id: 'line-c', quantity: '4' }] },
    ])
    expect(result.get('line-c')).toBe(4)
  })

  it('skips entries without an order line id or items array', () => {
    const result = sumShippedQuantityByLine([
      { items: [{ quantity: 5 }] },
      { items: null },
      {},
    ])
    expect(result.size).toBe(0)
  })
})
