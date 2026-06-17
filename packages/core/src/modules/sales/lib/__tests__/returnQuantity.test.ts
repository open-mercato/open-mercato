import { computeAvailableReturnQuantity } from '../returnQuantity'

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
