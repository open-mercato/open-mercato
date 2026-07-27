import {
  buildInventoryMutationReferenceId,
  computeCycleCountVariance,
  formatSignedQuantity,
  parseInventoryQuantity,
} from '../inventoryMutationUi'

describe('inventoryMutationUi', () => {
  it('parses numeric inventory quantities', () => {
    expect(parseInventoryQuantity('12.5')).toBe(12.5)
    expect(parseInventoryQuantity(3)).toBe(3)
    expect(parseInventoryQuantity(null)).toBe(0)
    expect(parseInventoryQuantity('invalid')).toBe(0)
  })

  it('computes cycle count variance as counted minus system on-hand', () => {
    expect(computeCycleCountVariance(5, 3)).toBe(-2)
    expect(computeCycleCountVariance(10, 10)).toBe(0)
    expect(computeCycleCountVariance(0, 4)).toBe(4)
  })

  it('formats signed quantities for display', () => {
    expect(formatSignedQuantity(2)).toBe('+2')
    expect(formatSignedQuantity(-2)).toBe('-2')
    expect(formatSignedQuantity(0)).toBe('0')
  })

  it('builds a UUID-shaped reference id', () => {
    const id = buildInventoryMutationReferenceId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})
