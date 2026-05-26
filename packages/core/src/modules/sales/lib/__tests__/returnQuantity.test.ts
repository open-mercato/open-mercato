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
