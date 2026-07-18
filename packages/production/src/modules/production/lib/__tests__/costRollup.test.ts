import { describe, it, expect } from '@jest/globals'
import { explodeBom, type BomItemsByProductKey } from '../bomGraph'
import { computeStandardCost, type CostRollupLine } from '../costRollup'

describe('computeStandardCost', () => {
  it('computes single-level material cost from catalog unit prices', () => {
    const lines: CostRollupLine[] = [{ componentKey: 'M1', qty: 10, bomUom: 'kg' }]
    const result = computeStandardCost({
      lines,
      unitPrices: { M1: { amount: 5, currency: 'USD', uom: 'kg' } },
      unitConversions: {},
      operations: [],
      workCenterRates: {},
      quantity: 10,
    })

    expect(result.materials).toBe(50)
    expect(result.labor).toBe(0)
    expect(result.total).toBe(50)
    expect(result.currency).toBe('USD')
    expect(result.missingPrices).toEqual([])
    expect(result.missingConversions).toEqual([])
  })

  it('rolls up a multi-level BOM explosion into a correct material total', () => {
    // A (root) -> B (x2) -> C (x3), no scrap.
    const bom: BomItemsByProductKey = {
      A: [{ componentKey: 'B', qtyPerUnit: 2 }],
      B: [{ componentKey: 'C', qtyPerUnit: 3 }],
    }
    const exploded = explodeBom(bom, 'A', 5) // rootQty = 5
    const lines: CostRollupLine[] = exploded.map((c) => ({ componentKey: c.componentKey, qty: c.qty, bomUom: 'pc' }))

    const result = computeStandardCost({
      lines,
      unitPrices: {
        B: { amount: 2, currency: 'USD', uom: 'pc' },
        C: { amount: 1, currency: 'USD', uom: 'pc' },
      },
      unitConversions: {},
      operations: [],
      workCenterRates: {},
      quantity: 5,
    })

    // B qty = 2 * 5 = 10, C qty = 6 * 5 = 30 (per explodeBom multi-level test)
    // materials = 10*2 + 30*1 = 20 + 30 = 50
    expect(result.materials).toBe(50)
  })

  it('reflects scrap-factor-increased quantities from explodeBom in the material cost', () => {
    const noScrapBom: BomItemsByProductKey = { A: [{ componentKey: 'B', qtyPerUnit: 2 }] }
    const scrapBom: BomItemsByProductKey = { A: [{ componentKey: 'B', qtyPerUnit: 2, scrapFactor: 0.1 }] }

    const noScrapLines: CostRollupLine[] = explodeBom(noScrapBom, 'A', 1).map((c) => ({
      componentKey: c.componentKey,
      qty: c.qty,
      bomUom: 'pc',
    }))
    const scrapLines: CostRollupLine[] = explodeBom(scrapBom, 'A', 1).map((c) => ({
      componentKey: c.componentKey,
      qty: c.qty,
      bomUom: 'pc',
    }))

    const unitPrices = { B: { amount: 10, currency: 'USD', uom: 'pc' } }
    const base = { unitConversions: {}, operations: [], workCenterRates: {}, quantity: 1 }

    const noScrapResult = computeStandardCost({ lines: noScrapLines, unitPrices, ...base })
    const scrapResult = computeStandardCost({ lines: scrapLines, unitPrices, ...base })

    expect(noScrapResult.materials).toBe(20)
    expect(scrapResult.materials).toBeCloseTo(22, 6)
    expect(scrapResult.materials).toBeGreaterThan(noScrapResult.materials)
  })

  it('applies a UoM conversion when the BOM line uom differs from the price uom (g -> kg)', () => {
    const lines: CostRollupLine[] = [{ componentKey: 'M1', qty: 500, bomUom: 'g' }]
    const result = computeStandardCost({
      lines,
      unitPrices: { M1: { amount: 10, currency: 'USD', uom: 'kg' } },
      unitConversions: { M1: { factor: 0.001 } },
      operations: [],
      workCenterRates: {},
      quantity: 1,
    })

    // 500g * 0.001 (g->kg factor) = 0.5kg; 0.5kg * 10/kg = 5
    expect(result.materials).toBeCloseTo(5, 6)
    expect(result.missingConversions).toEqual([])
  })

  it('collects a missing price into missingPrices instead of throwing', () => {
    const lines: CostRollupLine[] = [
      { componentKey: 'M1', qty: 10, bomUom: 'kg' },
      { componentKey: 'M2', qty: 5, bomUom: 'kg' },
    ]
    const result = computeStandardCost({
      lines,
      unitPrices: { M1: { amount: 5, currency: 'USD', uom: 'kg' } },
      unitConversions: {},
      operations: [],
      workCenterRates: {},
      quantity: 1,
    })

    expect(result.missingPrices).toEqual(['M2'])
    // M1 contributes 50; M2 is excluded (not silently zero-priced into a false total)
    expect(result.materials).toBe(50)
    const m2Line = result.lines.find((l) => l.componentKey === 'M2')
    expect(m2Line?.status).toBe('missing_price')
    expect(m2Line?.lineCost).toBeNull()
  })

  it('collects a missing UoM conversion into missingConversions instead of throwing', () => {
    const lines: CostRollupLine[] = [{ componentKey: 'M1', qty: 500, bomUom: 'g' }]
    const result = computeStandardCost({
      lines,
      unitPrices: { M1: { amount: 10, currency: 'USD', uom: 'kg' } },
      unitConversions: {},
      operations: [],
      workCenterRates: {},
      quantity: 1,
    })

    expect(result.missingConversions).toEqual(['M1'])
    expect(result.materials).toBe(0)
  })

  it('computes labor cost from setup time + run time per unit, scaled by order quantity', () => {
    const result = computeStandardCost({
      lines: [],
      unitPrices: {},
      unitConversions: {},
      operations: [{ workCenterId: 'wc1', setupTimeMinutes: 15, runTimePerUnitSeconds: 60 }],
      workCenterRates: { wc1: 90 },
      quantity: 5,
    })

    // laborMinutes = 15 + (60s * 5)/60 = 15 + 5 = 20min = 0.3333h; 0.3333h * 90/h = 30
    expect(result.labor).toBeCloseTo(30, 6)
    expect(result.materials).toBe(0)
    expect(result.total).toBeCloseTo(30, 6)
  })

  it('documents MVP mixed-currency handling: a second differing-currency price is collected, not silently summed', () => {
    const lines: CostRollupLine[] = [
      { componentKey: 'M1', qty: 10, bomUom: 'kg' },
      { componentKey: 'M2', qty: 5, bomUom: 'kg' },
    ]
    const result = computeStandardCost({
      lines,
      unitPrices: {
        M1: { amount: 5, currency: 'USD', uom: 'kg' },
        M2: { amount: 3, currency: 'EUR', uom: 'kg' },
      },
      unitConversions: {},
      operations: [],
      workCenterRates: {},
      quantity: 1,
    })

    expect(result.currency).toBe('USD')
    expect(result.mixedCurrency).toEqual(['M2'])
    expect(result.materials).toBe(50)
    const m2Line = result.lines.find((l) => l.componentKey === 'M2')
    expect(m2Line?.status).toBe('mixed_currency')
  })

  it('computes perUnit as total divided by order quantity', () => {
    const result = computeStandardCost({
      lines: [{ componentKey: 'M1', qty: 10, bomUom: 'pc' }],
      unitPrices: { M1: { amount: 4, currency: 'USD', uom: 'pc' } },
      unitConversions: {},
      operations: [{ workCenterId: 'wc1', setupTimeMinutes: 0, runTimePerUnitSeconds: 360 }],
      workCenterRates: { wc1: 60 },
      quantity: 10,
    })

    // materials = 40; labor: laborMinutes = 0 + (360*10)/60 = 60min = 1h * 60/h = 60
    expect(result.materials).toBe(40)
    expect(result.labor).toBeCloseTo(60, 6)
    expect(result.total).toBeCloseTo(100, 6)
    expect(result.perUnit).toBeCloseTo(10, 6)
  })
})
