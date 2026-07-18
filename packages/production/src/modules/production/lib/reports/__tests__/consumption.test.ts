import {
  computeConsumptionVariance,
  aggregateConsumptionByProduct,
  resolveConsumedUnitsForMaterial,
  type ConsumptionMaterialRow,
  type ConsumptionOperationLike,
} from '../consumption.js'

function makeRow(overrides: Partial<ConsumptionMaterialRow> = {}): ConsumptionMaterialRow {
  return {
    orderId: 'order-1',
    orderNumber: 1,
    componentProductId: 'component-1',
    componentVariantId: null,
    qtyPerUnit: '10',
    scrapFactor: '0',
    qtyIssued: '10',
    consumedUnits: 1,
    ...overrides,
  }
}

describe('computeConsumptionVariance', () => {
  // Hand-computed: qtyPerUnit=2, scrapFactor=0.5, consumedUnits=4
  // standard = 2 * (1 + 0.5) * 4 = 12; actual = 15 (backflush issued more
  // than the theoretical standard, e.g. a re-issue) => variance = 3, pct = 25%.
  it('scales standard by (1 + scrapFactor) * consumedUnits — scrap > 0 case', () => {
    const [line] = computeConsumptionVariance([
      makeRow({ qtyPerUnit: '2', scrapFactor: '0.5', consumedUnits: 4, qtyIssued: '15' }),
    ])
    expect(line.standardQty).toBe(12)
    expect(line.actualQty).toBe(15)
    expect(line.varianceQty).toBe(3)
    expect(line.variancePct).toBe(25)
  })

  // Hand-computed: qtyPerUnit=3, scrapFactor=0, consumedUnits=5 (multi-unit
  // order: 5 finished units consumed so far) => standard = 3 * 1 * 5 = 15;
  // actual (perfectly backflushed, matching theoretical) = 15 => variance 0.
  it('computes zero variance when actual exactly matches the scaled standard (multi-unit order)', () => {
    const [line] = computeConsumptionVariance([
      makeRow({ qtyPerUnit: '3', scrapFactor: '0', consumedUnits: 5, qtyIssued: '15' }),
    ])
    expect(line.standardQty).toBe(15)
    expect(line.varianceQty).toBe(0)
    expect(line.variancePct).toBe(0)
  })

  // Hand-computed: partially completed order (order-level: completed 3 of
  // 10 planned, scrapped 1 => consumedUnits basis = 3 + 1 = 4).
  // qtyPerUnit=5, scrapFactor=0 => standard = 5 * 1 * 4 = 20; actual = 18
  // (e.g. a partial-issue warning under-issued) => variance = -2, pct = -10%.
  it('uses the partially-completed consumedUnits basis (3 completed + 1 scrapped = 4)', () => {
    const [line] = computeConsumptionVariance([
      makeRow({ qtyPerUnit: '5', scrapFactor: '0', consumedUnits: 4, qtyIssued: '18' }),
    ])
    expect(line.standardQty).toBe(20)
    expect(line.actualQty).toBe(18)
    expect(line.varianceQty).toBe(-2)
    expect(line.variancePct).toBe(-10)
  })

  it('guards division by zero: consumedUnits=0 (zero-completed order) yields standardQty=0 and variancePct=null, variance=actual', () => {
    const [line] = computeConsumptionVariance([
      makeRow({ qtyPerUnit: '5', scrapFactor: '0.2', consumedUnits: 0, qtyIssued: '7' }),
    ])
    expect(line.standardQty).toBe(0)
    expect(line.varianceQty).toBe(7)
    expect(line.variancePct).toBeNull()
  })

  it('zero standard and zero actual yields zero variance and null percentage', () => {
    const [line] = computeConsumptionVariance([makeRow({ consumedUnits: 0, qtyIssued: '0' })])
    expect(line.varianceQty).toBe(0)
    expect(line.variancePct).toBeNull()
  })
})

describe('aggregateConsumptionByProduct', () => {
  it('sums standard/actual across multiple orders for the same component product', () => {
    const lines = computeConsumptionVariance([
      makeRow({ orderId: 'order-1', qtyPerUnit: '10', scrapFactor: '0', consumedUnits: 1, qtyIssued: '12' }),
      makeRow({ orderId: 'order-2', qtyPerUnit: '5', scrapFactor: '0', consumedUnits: 1, qtyIssued: '4' }),
    ])
    const aggregates = aggregateConsumptionByProduct(lines)
    expect(aggregates).toHaveLength(1)
    expect(aggregates[0].standardQty).toBe(15)
    expect(aggregates[0].actualQty).toBe(16)
    expect(aggregates[0].varianceQty).toBe(1)
    expect(aggregates[0].orderCount).toBe(2)
  })

  it('keeps separate buckets per componentVariantId', () => {
    const lines = computeConsumptionVariance([
      makeRow({ componentVariantId: 'variant-a', qtyPerUnit: '10', consumedUnits: 1, qtyIssued: '10' }),
      makeRow({ componentVariantId: 'variant-b', qtyPerUnit: '5', consumedUnits: 1, qtyIssued: '5' }),
    ])
    const aggregates = aggregateConsumptionByProduct(lines)
    expect(aggregates).toHaveLength(2)
  })

  it('guards division by zero at the aggregate level too', () => {
    const lines = computeConsumptionVariance([makeRow({ consumedUnits: 0, qtyIssued: '3' })])
    const [aggregate] = aggregateConsumptionByProduct(lines)
    expect(aggregate.variancePct).toBeNull()
  })

  it('counts each order once even with multiple material lines for the same order+product', () => {
    const lines = computeConsumptionVariance([
      makeRow({ orderId: 'order-1', qtyPerUnit: '5', consumedUnits: 1, qtyIssued: '5' }),
      makeRow({ orderId: 'order-1', qtyPerUnit: '5', consumedUnits: 1, qtyIssued: '5' }),
    ])
    const [aggregate] = aggregateConsumptionByProduct(lines)
    expect(aggregate.orderCount).toBe(1)
    expect(aggregate.standardQty).toBe(10)
  })
})

describe('resolveConsumedUnitsForMaterial', () => {
  function makeOp(overrides: Partial<ConsumptionOperationLike> = {}): ConsumptionOperationLike {
    return { sequence: 1, isReportingPoint: true, qtyGood: '0', qtyScrap: '0', ...overrides }
  }

  it('resolves an operationSequence-pinned material against that operation cumulative qtyGood+qtyScrap', () => {
    const operations = [
      makeOp({ sequence: 1, qtyGood: '3', qtyScrap: '1' }),
      makeOp({ sequence: 2, qtyGood: '9', qtyScrap: '0' }),
    ]
    expect(resolveConsumedUnitsForMaterial(1, operations)).toBe(4)
    expect(resolveConsumedUnitsForMaterial(2, operations)).toBe(9)
  })

  it('returns 0 for a pinned operationSequence with no matching operation (not yet reported)', () => {
    const operations = [makeOp({ sequence: 1, qtyGood: '5', qtyScrap: '0' })]
    expect(resolveConsumedUnitsForMaterial(99, operations)).toBe(0)
  })

  it('resolves an unpinned (null) material against the LAST reporting-point operation by sequence', () => {
    const operations = [
      makeOp({ sequence: 1, isReportingPoint: true, qtyGood: '10', qtyScrap: '0' }),
      makeOp({ sequence: 2, isReportingPoint: false, qtyGood: '999', qtyScrap: '999' }),
      makeOp({ sequence: 3, isReportingPoint: true, qtyGood: '3', qtyScrap: '1' }),
    ]
    expect(resolveConsumedUnitsForMaterial(null, operations)).toBe(4)
  })

  it('returns 0 for an unpinned material when there are no reporting-point operations', () => {
    const operations = [makeOp({ sequence: 1, isReportingPoint: false, qtyGood: '10', qtyScrap: '0' })]
    expect(resolveConsumedUnitsForMaterial(null, operations)).toBe(0)
  })
})
