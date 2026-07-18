import {
  selectBackflushMaterials,
  computeBackflushIssueLines,
  convertQtyToStockUom,
  type BackflushMaterialLine,
} from '../backflush.js'

function material(overrides: Partial<BackflushMaterialLine> = {}): BackflushMaterialLine {
  return {
    id: 'material-1',
    componentProductId: 'component-1',
    componentVariantId: null,
    operationSequence: null,
    qtyPerUnit: 2,
    scrapFactor: 0,
    uom: 'pcs',
    ...overrides,
  }
}

describe('selectBackflushMaterials', () => {
  it('selects materials assigned to the reported operation sequence', () => {
    const materials = [
      material({ id: 'm-1', operationSequence: 1 }),
      material({ id: 'm-2', operationSequence: 2 }),
    ]
    expect(selectBackflushMaterials(materials, 1, false)).toEqual([materials[0]])
  })

  it('selects operation-unassigned (null operationSequence) materials only on the last reporting-point operation', () => {
    const materials = [material({ id: 'm-1', operationSequence: null })]
    expect(selectBackflushMaterials(materials, 2, false)).toEqual([])
    expect(selectBackflushMaterials(materials, 2, true)).toEqual(materials)
  })

  it('never backflushes an operation-unassigned material on a non-last reporting operation', () => {
    const materials = [
      material({ id: 'm-1', operationSequence: 1 }),
      material({ id: 'm-2', operationSequence: null }),
    ]
    expect(selectBackflushMaterials(materials, 1, false)).toEqual([materials[0]])
  })
})

describe('computeBackflushIssueLines', () => {
  it('consumes qtyPerUnit * reported good qty for a zero-scrap-factor line', () => {
    const materials = [material({ qtyPerUnit: 2, scrapFactor: 0 })]
    const lines = computeBackflushIssueLines(materials, 5, 0)
    expect(lines).toEqual([
      { materialId: 'material-1', componentProductId: 'component-1', componentVariantId: null, qtyInMaterialUom: 10, uom: 'pcs' },
    ])
  })

  it('consumes material for BOTH good and scrap reported units (task 4.1 decision)', () => {
    const materials = [material({ qtyPerUnit: 2, scrapFactor: 0 })]
    const lines = computeBackflushIssueLines(materials, 5, 3)
    expect(lines[0].qtyInMaterialUom).toBe(16) // 2 * (5 + 3)
  })

  it('applies the BOM scrap factor as a multiplicative surcharge on top of consumed units', () => {
    const materials = [material({ qtyPerUnit: 10, scrapFactor: 0.1 })]
    const lines = computeBackflushIssueLines(materials, 2, 0)
    expect(lines[0].qtyInMaterialUom).toBeCloseTo(22) // 10 * 1.1 * 2
  })

  it('computes independent lines for a partial report (fewer reported units than the full order)', () => {
    const materials = [material({ id: 'm-1', qtyPerUnit: 3, scrapFactor: 0 })]
    const partial = computeBackflushIssueLines(materials, 1, 0)
    expect(partial[0].qtyInMaterialUom).toBe(3)
  })
})

describe('convertQtyToStockUom', () => {
  it('passes the quantity through unchanged when material and stock uoms already match', () => {
    expect(convertQtyToStockUom(10, 'pcs', 'pcs', null)).toEqual({ qty: 10, converted: false })
    expect(convertQtyToStockUom(10, 'KG', 'kg', null)).toEqual({ qty: 10, converted: false })
  })

  it('converts using the provided toBaseFactor when uoms differ', () => {
    // 1 box = 12 pcs; material line is in "box", stock item is in "pcs" (base).
    expect(convertQtyToStockUom(3, 'box', 'pcs', 12)).toEqual({ qty: 36, converted: true })
  })

  it('reports missing_conversion when uoms differ and no factor is available', () => {
    expect(convertQtyToStockUom(3, 'box', 'pcs', null)).toEqual({ error: 'missing_conversion' })
    expect(convertQtyToStockUom(3, 'box', 'pcs', undefined)).toEqual({ error: 'missing_conversion' })
  })

  it('reports missing_conversion for a non-positive or non-finite factor', () => {
    expect(convertQtyToStockUom(3, 'box', 'pcs', 0)).toEqual({ error: 'missing_conversion' })
    expect(convertQtyToStockUom(3, 'box', 'pcs', -2)).toEqual({ error: 'missing_conversion' })
    expect(convertQtyToStockUom(3, 'box', 'pcs', Number.NaN)).toEqual({ error: 'missing_conversion' })
  })
})
