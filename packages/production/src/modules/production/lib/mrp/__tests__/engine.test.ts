export {}

import { runMrp } from '../engine'
import { makeProductKey } from '../types'
import type { MrpInputs, MrpBomVersion, MrpPlanningParams, MrpStock } from '../types'

/**
 * Task 5.1 — MRP engine DoD matrix (TDD, `[tdd:required]`).
 *
 * Every case below hand-computes the expected numbers in the test itself so
 * the assertion is never "whatever the implementation currently returns".
 * `runMrp` is pure (no ORM/em access anywhere in this file) — bulk loading
 * lives in `loaders.ts` and is covered by `loaders.test.ts`.
 */

const ASOF = '2026-01-01'

function bom(items: MrpBomVersion['items'], validFrom: string | null = null, validTo: string | null = null): MrpBomVersion {
  return { productKey: '', validFrom, validTo, items }
}

function params(overrides: Partial<MrpPlanningParams> = {}): MrpPlanningParams {
  return {
    procurement: 'buy',
    leadTimeDays: 0,
    minLot: 0,
    lotMultiple: 0,
    safetyStock: 0,
    ...overrides,
  }
}

function stock(overrides: Partial<MrpStock> = {}): MrpStock {
  return { onHand: 0, reserved: 0, uom: 'pcs', ...overrides }
}

function baseInputs(overrides: Partial<MrpInputs> = {}): MrpInputs {
  return {
    asOfDate: ASOF,
    demands: [],
    bomVersionsByProductKey: {},
    planningParamsByProductKey: {},
    stockByProductKey: {},
    openSupply: [],
    unitConversionsByProductKey: {},
    ...overrides,
  }
}

describe('runMrp — multi-level explosion + backward scheduling (case 1)', () => {
  it('generates level-ordered make suggestions with backward-scheduled dates for a 3-deep make chain', () => {
    // P (leadTime 5) -> A (leadTime 3) -> B (leadTime 2) -> X (buy, leaf)
    // qtyPerUnit = 1 at every level so quantities stay 10 end to end.
    const inputs = baseInputs({
      demands: [{ productKey: 'P', qty: 10, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-1' } }],
      bomVersionsByProductKey: {
        P: [bom([{ componentKey: 'A', qtyPerUnit: 1, uom: 'pcs' }])],
        A: [bom([{ componentKey: 'B', qtyPerUnit: 1, uom: 'pcs' }])],
        B: [bom([{ componentKey: 'X', qtyPerUnit: 1, uom: 'pcs' }])],
      },
      planningParamsByProductKey: {
        P: params({ procurement: 'make', leadTimeDays: 5 }),
        A: params({ procurement: 'make', leadTimeDays: 3 }),
        B: params({ procurement: 'make', leadTimeDays: 2 }),
        X: params({ procurement: 'buy', leadTimeDays: 0 }),
      },
    })

    const result = runMrp(inputs)

    const byProduct = (key: string) => result.suggestions.filter((s) => s.productKey === key)
    expect(byProduct('P')).toEqual([
      expect.objectContaining({ type: 'make', productKey: 'P', qty: 10, dueDate: '2026-08-01' }),
    ])
    expect(byProduct('A')).toEqual([
      expect.objectContaining({ type: 'make', productKey: 'A', qty: 10, dueDate: '2026-07-27' }),
    ])
    expect(byProduct('B')).toEqual([
      expect.objectContaining({ type: 'make', productKey: 'B', qty: 10, dueDate: '2026-07-24' }),
    ])
    expect(byProduct('X')).toEqual([
      expect.objectContaining({ type: 'buy', productKey: 'X', qty: 10, dueDate: '2026-07-22' }),
    ])

    // level-ordered: P before A before B before X
    const order = result.suggestions.map((s) => s.productKey)
    expect(order.indexOf('P')).toBeLessThan(order.indexOf('A'))
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'))
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('X'))
  })
})

describe('runMrp — phantom pass-through (case 2)', () => {
  it('never emits a suggestion for a phantom item, only for the real component beneath it', () => {
    const inputs = baseInputs({
      demands: [{ productKey: 'P', qty: 5, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-1' } }],
      bomVersionsByProductKey: {
        P: [bom([{ componentKey: 'PHANTOM', qtyPerUnit: 1, uom: 'pcs', isPhantom: true }])],
        PHANTOM: [bom([{ componentKey: 'R', qtyPerUnit: 2, uom: 'pcs' }])],
      },
      planningParamsByProductKey: {
        P: params({ procurement: 'make' }),
        R: params({ procurement: 'buy' }),
      },
    })

    const result = runMrp(inputs)

    expect(result.suggestions.some((s) => s.productKey === 'PHANTOM')).toBe(false)
    expect(result.suggestions.find((s) => s.productKey === 'R')).toEqual(
      expect.objectContaining({ type: 'buy', productKey: 'R', qty: 10, dueDate: '2026-08-01' }),
    )
  })
})

describe('runMrp — scrap factor compounds level over level (case 3)', () => {
  it('compounds the scrap factor of each level into the deepest component demand', () => {
    // P -> A (qtyPerUnit 1, scrap 0.1) -> R (qtyPerUnit 1, scrap 0.2)
    // A demand = 10 * 1 * 1.1 = 11
    // R demand = 11 * 1 * 1.2 = 13.2
    const inputs = baseInputs({
      demands: [{ productKey: 'P', qty: 10, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-1' } }],
      bomVersionsByProductKey: {
        P: [bom([{ componentKey: 'A', qtyPerUnit: 1, uom: 'pcs', scrapFactor: 0.1 }])],
        A: [bom([{ componentKey: 'R', qtyPerUnit: 1, uom: 'pcs', scrapFactor: 0.2 }])],
      },
      planningParamsByProductKey: {
        P: params({ procurement: 'make' }),
        A: params({ procurement: 'make' }),
        R: params({ procurement: 'buy' }),
      },
    })

    const result = runMrp(inputs)

    const a = result.suggestions.find((s) => s.productKey === 'A')
    const r = result.suggestions.find((s) => s.productKey === 'R')
    expect(a?.qty).toBeCloseTo(11, 6)
    expect(r?.qty).toBeCloseTo(13.2, 6)
  })
})

describe('runMrp — UoM conversion at BOM lines (case 4)', () => {
  it('converts a gram-denominated BOM line into the kg stock uom, and warns (not crashes) on a missing conversion', () => {
    const inputs = baseInputs({
      demands: [{ productKey: 'P', qty: 10, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-1' } }],
      bomVersionsByProductKey: {
        P: [
          bom([
            { componentKey: 'FLOUR', qtyPerUnit: 100, uom: 'g' },
            { componentKey: 'DYE', qtyPerUnit: 5, uom: 'ml' },
          ]),
        ],
      },
      planningParamsByProductKey: {
        P: params({ procurement: 'make' }),
        FLOUR: params({ procurement: 'buy' }),
        DYE: params({ procurement: 'buy' }),
      },
      stockByProductKey: {
        FLOUR: stock({ uom: 'kg' }),
        // DYE has no stock item -> its BOM uom ('ml') is treated as the
        // component uom, so no conversion is needed and no warning fires for
        // DYE; the missing-conversion case below uses a distinct component.
      },
      unitConversionsByProductKey: {
        FLOUR: { factor: 0.001, fromUom: 'g' },
      },
    })

    const result = runMrp(inputs)

    const flour = result.suggestions.find((s) => s.productKey === 'FLOUR')
    expect(flour?.qty).toBeCloseTo(1, 6) // 10 * 100g * 0.001 = 1kg
    expect(flour?.uom).toBe('kg')

    // Now force a missing-conversion case: BOM line in 'g', stock in 'kg', no conversion registered.
    const inputsMissing = baseInputs({
      demands: [{ productKey: 'P', qty: 10, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-1' } }],
      bomVersionsByProductKey: {
        P: [bom([{ componentKey: 'SUGAR', qtyPerUnit: 50, uom: 'g' }])],
      },
      planningParamsByProductKey: {
        P: params({ procurement: 'make' }),
        SUGAR: params({ procurement: 'buy' }),
      },
      stockByProductKey: {
        SUGAR: stock({ uom: 'kg' }),
      },
    })

    const resultMissing = runMrp(inputsMissing)
    expect(resultMissing.suggestions.some((s) => s.productKey === 'SUGAR')).toBe(false)
    expect(resultMissing.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing_unit_conversion', productKey: 'SUGAR' })]),
    )
  })
})

describe('runMrp — BOM version selection by due date (case 5)', () => {
  it('selects the active BOM version whose valid_from/valid_to window contains the demand due date', () => {
    const bomVersionsByProductKey = {
      P: [
        bom([{ componentKey: 'R1', qtyPerUnit: 1, uom: 'pcs' }], null, '2026-06-30'),
        bom([{ componentKey: 'R2', qtyPerUnit: 1, uom: 'pcs' }], '2026-07-01', null),
      ],
    }
    const planningParamsByProductKey = {
      P: params({ procurement: 'make' }),
      R1: params({ procurement: 'buy' }),
      R2: params({ procurement: 'buy' }),
    }

    const oldVersionResult = runMrp(
      baseInputs({
        demands: [{ productKey: 'P', qty: 4, uom: 'pcs', dueDate: '2026-06-01', source: { type: 'sales_order', id: 'so-1' } }],
        bomVersionsByProductKey,
        planningParamsByProductKey,
      }),
    )
    expect(oldVersionResult.suggestions.some((s) => s.productKey === 'R1')).toBe(true)
    expect(oldVersionResult.suggestions.some((s) => s.productKey === 'R2')).toBe(false)

    const newVersionResult = runMrp(
      baseInputs({
        demands: [{ productKey: 'P', qty: 4, uom: 'pcs', dueDate: '2026-07-15', source: { type: 'sales_order', id: 'so-2' } }],
        bomVersionsByProductKey,
        planningParamsByProductKey,
      }),
    )
    expect(newVersionResult.suggestions.some((s) => s.productKey === 'R2')).toBe(true)
    expect(newVersionResult.suggestions.some((s) => s.productKey === 'R1')).toBe(false)
  })
})

describe('runMrp — min-stock deficit demand + safety stock netting (case 6)', () => {
  it('turns a min-stock-sourced demand entry into a suggestion', () => {
    // A min-stock demand entry is only ever emitted (by the loader) when
    // free stock is already below the safety-stock floor, so `safetyStock`
    // is set here to the same 100-unit threshold the deficit (100 - 20 = 80)
    // was computed against -- this keeps the engine's own on-hand
    // consumption from also "spending" the 20 units a second time.
    const result = runMrp(
      baseInputs({
        demands: [{ productKey: 'Q', qty: 80, uom: 'kg', dueDate: ASOF, source: { type: 'min_stock', id: null } }],
        planningParamsByProductKey: { Q: params({ procurement: 'buy', safetyStock: 100 }) },
        stockByProductKey: { Q: stock({ onHand: 20, reserved: 0, uom: 'kg' }) },
      }),
    )
    expect(result.suggestions).toEqual([
      expect.objectContaining({ type: 'buy', productKey: 'Q', qty: 80, dueDate: ASOF }),
    ])
  })

  it('raises the net requirement by the configured safety stock', () => {
    const result = runMrp(
      baseInputs({
        demands: [{ productKey: 'Z', qty: 50, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-1' } }],
        planningParamsByProductKey: { Z: params({ procurement: 'buy', safetyStock: 20 }) },
        stockByProductKey: { Z: stock({ onHand: 60, reserved: 0, uom: 'pcs' }) },
      }),
    )
    // Without safety stock: 50 - 60 = fully covered (no suggestion).
    // With a 20-unit safety floor: usable stock is 60 - 20 = 40, net = 50 - 40 = 10.
    expect(result.suggestions).toEqual([
      expect.objectContaining({ type: 'buy', productKey: 'Z', qty: 10, dueDate: '2026-08-01' }),
    ])
  })
})

describe('runMrp — in-progress (open supply) netting (case 7)', () => {
  it('reduces the suggestion when open supply is due before the demand date', () => {
    const result = runMrp(
      baseInputs({
        demands: [{ productKey: 'W', qty: 30, uom: 'pcs', dueDate: '2026-08-10', source: { type: 'sales_order', id: 'so-1' } }],
        planningParamsByProductKey: { W: params({ procurement: 'buy' }) },
        openSupply: [{ productKey: 'W', qty: 20, uom: 'pcs', dueDate: '2026-08-05', sourceId: 'po-1', status: 'released' }],
      }),
    )
    expect(result.suggestions).toEqual([
      expect.objectContaining({ type: 'buy', productKey: 'W', qty: 10, dueDate: '2026-08-10' }),
    ])
  })

  it('proposes a reschedule when open supply is due after the demand date it could otherwise cover', () => {
    const result = runMrp(
      baseInputs({
        demands: [{ productKey: 'V', qty: 15, uom: 'pcs', dueDate: '2026-08-10', source: { type: 'sales_order', id: 'so-1' } }],
        planningParamsByProductKey: { V: params({ procurement: 'buy' }) },
        openSupply: [{ productKey: 'V', qty: 15, uom: 'pcs', dueDate: '2026-08-20', sourceId: 'po-2', status: 'released' }],
      }),
    )
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        type: 'reschedule',
        productKey: 'V',
        qty: 15,
        dueDate: '2026-08-10',
        openSupplySourceId: 'po-2',
        previousDueDate: '2026-08-20',
      }),
    ])
    // The reschedule fully resolves the demand -- no separate buy suggestion.
    expect(result.suggestions.filter((s) => s.productKey === 'V')).toHaveLength(1)
  })

  it('proposes a cancel when open supply has no demand to cover at all', () => {
    const result = runMrp(
      baseInputs({
        planningParamsByProductKey: { U: params({ procurement: 'buy' }) },
        openSupply: [{ productKey: 'U', qty: 8, uom: 'pcs', dueDate: '2026-08-01', sourceId: 'po-3', status: 'in_progress' }],
      }),
    )
    expect(result.suggestions).toEqual([
      expect.objectContaining({ type: 'cancel', productKey: 'U', qty: 8, dueDate: '2026-08-01', openSupplySourceId: 'po-3' }),
    ])
  })
})

describe('runMrp — lot sizing: min lot + multiple (case 8)', () => {
  it('rounds a net requirement of 60 up to 75 with minLot 50 / multiple 25', () => {
    const result = runMrp(
      baseInputs({
        demands: [{ productKey: 'T', qty: 60, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-1' } }],
        planningParamsByProductKey: { T: params({ procurement: 'buy', minLot: 50, lotMultiple: 25 }) },
      }),
    )
    expect(result.suggestions).toEqual([
      expect.objectContaining({ type: 'buy', productKey: 'T', qty: 75, dueDate: '2026-08-01' }),
    ])
  })
})

describe('runMrp — shared component aggregates across parents before lot sizing (case 9)', () => {
  it('sums demand for a component shared by two parents into one bucket before applying lot sizing', () => {
    // A due 2026-08-05, leadTime 5 -> C due 2026-07-31, qtyPerUnit 2 -> 10*2 = 20
    // B due 2026-08-03, leadTime 3 -> C due 2026-07-31, qtyPerUnit 4 -> 5*4 = 20
    // Aggregated C demand at 2026-07-31 = 40 -> lot-sized (minLot 50, multiple 10) -> 50
    const result = runMrp(
      baseInputs({
        demands: [
          { productKey: 'A', qty: 10, uom: 'pcs', dueDate: '2026-08-05', source: { type: 'sales_order', id: 'so-a' } },
          { productKey: 'B', qty: 5, uom: 'pcs', dueDate: '2026-08-03', source: { type: 'sales_order', id: 'so-b' } },
        ],
        bomVersionsByProductKey: {
          A: [bom([{ componentKey: 'C', qtyPerUnit: 2, uom: 'pcs' }])],
          B: [bom([{ componentKey: 'C', qtyPerUnit: 4, uom: 'pcs' }])],
        },
        planningParamsByProductKey: {
          A: params({ procurement: 'make', leadTimeDays: 5 }),
          B: params({ procurement: 'make', leadTimeDays: 3 }),
          C: params({ procurement: 'buy', minLot: 50, lotMultiple: 10 }),
        },
      }),
    )

    const cSuggestions = result.suggestions.filter((s) => s.productKey === 'C')
    expect(cSuggestions).toHaveLength(1)
    expect(cSuggestions[0]).toEqual(expect.objectContaining({ qty: 50, dueDate: '2026-07-31' }))
  })
})

describe('runMrp — buy product two levels down pegs to both root demands (case 10)', () => {
  it('pegs a shared buy-level component back to both originating root demand sources', () => {
    const result = runMrp(
      baseInputs({
        demands: [
          { productKey: 'D1', qty: 10, uom: 'pcs', dueDate: '2026-08-06', source: { type: 'sales_order', id: 'so-1' } },
          { productKey: 'D2', qty: 5, uom: 'pcs', dueDate: '2026-08-06', source: { type: 'sales_order', id: 'so-2' } },
        ],
        bomVersionsByProductKey: {
          D1: [bom([{ componentKey: 'C', qtyPerUnit: 1, uom: 'pcs' }])],
          D2: [bom([{ componentKey: 'C', qtyPerUnit: 1, uom: 'pcs' }])],
        },
        planningParamsByProductKey: {
          D1: params({ procurement: 'make' }),
          D2: params({ procurement: 'make' }),
          C: params({ procurement: 'buy' }),
        },
      }),
    )

    const c = result.suggestions.find((s) => s.productKey === 'C')
    expect(c).toEqual(expect.objectContaining({ type: 'buy', qty: 15, dueDate: '2026-08-06' }))
    expect(c?.pegging).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productKey: 'D1', qty: 10, source: { type: 'sales_order', id: 'so-1' } }),
        expect.objectContaining({ productKey: 'D2', qty: 5, source: { type: 'sales_order', id: 'so-2' } }),
      ]),
    )
  })
})

describe('runMrp — variant-aware ProductKey (review follow-up)', () => {
  it('nets two variants of the same product independently, each against its own stock row', () => {
    const variantA = makeProductKey('SHIRT', 'red')
    const variantB = makeProductKey('SHIRT', 'blue')

    const result = runMrp(
      baseInputs({
        demands: [
          { productKey: variantA, qty: 20, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-red' } },
          { productKey: variantB, qty: 20, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-blue' } },
        ],
        planningParamsByProductKey: {
          [variantA]: params({ procurement: 'buy' }),
          [variantB]: params({ procurement: 'buy' }),
        },
        // Distinct on-hand per variant: if the loader (or the engine) ever
        // collapsed these to a bare productId key, one row would silently
        // overwrite the other and both suggestions would net against the
        // SAME (wrong) on-hand figure.
        stockByProductKey: {
          [variantA]: stock({ onHand: 5, uom: 'pcs' }),
          [variantB]: stock({ onHand: 15, uom: 'pcs' }),
        },
      }),
    )

    const red = result.suggestions.find((s) => s.productKey === variantA)
    const blue = result.suggestions.find((s) => s.productKey === variantB)
    expect(red).toEqual(expect.objectContaining({ productId: 'SHIRT', variantId: 'red', qty: 15 }))
    expect(blue).toEqual(expect.objectContaining({ productId: 'SHIRT', variantId: 'blue', qty: 5 }))
  })

  it('falls back to the product-level BOM (variantId null) when a variant has no BOM of its own', () => {
    const productLevelKey = makeProductKey('MUG', null)
    const variantKey = makeProductKey('MUG', 'glow-in-dark')

    const result = runMrp(
      baseInputs({
        demands: [{ productKey: variantKey, qty: 4, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-1' } }],
        bomVersionsByProductKey: {
          // Only the product-level (variant-less) BOM exists.
          [productLevelKey]: [bom([{ componentKey: 'CERAMIC', qtyPerUnit: 1, uom: 'kg' }])],
        },
        planningParamsByProductKey: {
          [variantKey]: params({ procurement: 'make' }),
          CERAMIC: params({ procurement: 'buy' }),
        },
      }),
    )

    expect(result.suggestions.find((s) => s.productKey === variantKey)).toEqual(
      expect.objectContaining({ type: 'make', productId: 'MUG', variantId: 'glow-in-dark', qty: 4 }),
    )
    const ceramic = result.suggestions.find((s) => s.productKey === 'CERAMIC')
    expect(ceramic).toEqual(expect.objectContaining({ qty: 4 }))
  })

  it('does NOT fall back to a different variant that happens to have its own BOM', () => {
    const variantWithBom = makeProductKey('MUG', 'plain')
    const variantWithoutBom = makeProductKey('MUG', 'glow-in-dark')

    const result = runMrp(
      baseInputs({
        demands: [{ productKey: variantWithoutBom, qty: 3, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-1' } }],
        bomVersionsByProductKey: {
          [variantWithBom]: [bom([{ componentKey: 'CERAMIC', qtyPerUnit: 1, uom: 'kg' }])],
        },
        planningParamsByProductKey: {
          [variantWithoutBom]: params({ procurement: 'make' }),
        },
      }),
    )

    // No product-level (variantId null) BOM exists either, and this variant
    // must NOT silently reuse a sibling variant's BOM -> missing_bom_version.
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing_bom_version', productKey: variantWithoutBom })]),
    )
    expect(result.suggestions.find((s) => s.productKey === 'CERAMIC')).toBeUndefined()
  })
})

describe('runMrp — stats', () => {
  it('reports the number of demands processed', () => {
    const result = runMrp(
      baseInputs({
        demands: [{ productKey: 'P', qty: 1, uom: 'pcs', dueDate: '2026-08-01', source: { type: 'sales_order', id: 'so-1' } }],
        planningParamsByProductKey: { P: params({ procurement: 'buy' }) },
      }),
    )
    expect(result.stats.demandsProcessed).toBe(1)
  })
})
