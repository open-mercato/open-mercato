import {
  calculateDocumentTotals,
  calculateLine,
  createSalesCalculationRegistry,
} from '../calculations'
import type { SalesLineSnapshot } from '../types'

const ethContext = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  currencyCode: 'ETH',
  amountDecimalPlaces: 18,
}

const wei = '0.000000000000000001'

describe('sales calculations with arbitrary precision', () => {
  it('keeps 18 decimal place unit prices exact through line and document totals', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 3,
        currencyCode: 'ETH',
        unitPriceNet: Number(wei),
        unitPriceNetExact: wei,
        taxRate: 0,
      },
      {
        kind: 'product',
        quantity: 1,
        currencyCode: 'ETH',
        unitPriceNet: Number('1.123456789012345678'),
        unitPriceNetExact: '1.123456789012345678',
        taxRate: 0,
      },
    ]

    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      context: ethContext,
    })

    expect(result.lines[0].netAmountExact).toBe('0.000000000000000003')
    expect(result.totals.grandTotalNetAmountExact).toBe('1.123456789012345681')
    expect(result.totals.grandTotalGrossAmountExact).toBe('1.123456789012345681')
    expect(result.totals.grandTotalNetAmount).toBe(Number('1.123456789012345681'))
  })

  it('rounds tax to the currency precision instead of 4 decimals', async () => {
    const result = await calculateLine({
      documentKind: 'order',
      line: {
        kind: 'product',
        quantity: 1,
        currencyCode: 'ETH',
        unitPriceNet: 0.123456789,
        unitPriceNetExact: '0.123456789',
        taxRate: 23,
      },
      context: ethContext,
    })

    expect(result.taxAmountExact).toBe('0.02839506147')
    expect(result.grossAmountExact).toBe('0.15185185047')
    expect(result.amountDecimalPlaces).toBe(18)
  })

  it('keeps the 4 decimal default for fiat currencies', async () => {
    const result = await calculateLine({
      documentKind: 'order',
      line: { kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 0.123456789, taxRate: 23 },
      context: { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'USD' },
    })

    expect(result.netAmountExact).toBe('0.1235')
    expect(result.taxAmountExact).toBe('0.0284')
    expect(result.netAmount).toBe(0.1235)
  })

  it('applies totals on payments exactly', async () => {
    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [
        { kind: 'product', quantity: 1, currencyCode: 'ETH', unitPriceNet: 1, unitPriceNetExact: '1', taxRate: 0 },
      ],
      context: ethContext,
      existingTotals: { paidTotalAmount: Number('0.999999999999999999'), paidTotalAmountExact: '0.999999999999999999' },
    })

    expect(result.totals.outstandingAmountExact).toBe(wei)
  })

  it('re-derives exact amounts when a legacy hook changes only the float field', async () => {
    const registry = createSalesCalculationRegistry()
    registry.registerLineCalculator(({ current }) => ({ ...current, netAmount: 42 }))

    const result = await registry.calculateLine({
      documentKind: 'order',
      line: { kind: 'product', quantity: 1, currencyCode: 'ETH', unitPriceNet: 1, unitPriceNetExact: '1.000000000000000001' },
      context: ethContext,
    })

    expect(result.netAmountExact).toBe('42')
    expect(result.grossAmountExact).toBe('1.000000000000000001')
  })

  it('keeps a hook change made only to the exact field', async () => {
    const registry = createSalesCalculationRegistry()
    registry.registerLineCalculator(({ current }) => ({ ...current, netAmountExact: '0.000000000000000007' }))

    const result = await registry.calculateLine({
      documentKind: 'order',
      line: { kind: 'product', quantity: 1, currencyCode: 'ETH', unitPriceNet: 1, unitPriceNetExact: '1' },
      context: ethContext,
    })

    expect(result.netAmountExact).toBe('0.000000000000000007')
    expect(result.netAmount).toBe(7e-18)
  })

  it('keeps a totals hook change made only to the exact field', async () => {
    const registry = createSalesCalculationRegistry()
    registry.registerTotalsCalculator(({ current }) => ({
      ...current,
      totals: { ...current.totals, grandTotalGrossAmountExact: '2.000000000000000001' },
    }))

    const result = await registry.calculateDocument({
      documentKind: 'order',
      lines: [{ kind: 'product', quantity: 1, currencyCode: 'ETH', unitPriceNet: 1, unitPriceNetExact: '1' }],
      context: ethContext,
    })

    expect(result.totals.grandTotalGrossAmountExact).toBe('2.000000000000000001')
  })

  it('rounds a float set by a legacy hook to the amount precision', async () => {
    const registry = createSalesCalculationRegistry()
    registry.registerLineCalculator(({ current }) => ({ ...current, netAmount: 0.1 + 0.2 }))
    registry.registerTotalsCalculator(({ current }) => ({
      ...current,
      totals: { ...current.totals, grandTotalGrossAmount: 0.1 + 0.2 },
    }))
    const line: SalesLineSnapshot = { kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 1, taxRate: 0 }
    const context = { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'USD' }

    const lineResult = await registry.calculateLine({ documentKind: 'order', line, context })
    const documentResult = await registry.calculateDocument({ documentKind: 'order', lines: [line], context })

    expect(lineResult.netAmountExact).toBe('0.3')
    expect(lineResult.netAmount).toBe(0.3)
    expect(documentResult.totals.grandTotalGrossAmountExact).toBe('0.3')
  })

  describe('pairs hook amounts by id', () => {
    const usdContext = { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'USD' }
    const productLine = (id: string, unitPriceNet: number): SalesLineSnapshot => ({
      id,
      kind: 'product',
      quantity: 1,
      currencyCode: 'USD',
      unitPriceNet,
      taxRate: 0,
    })

    it('keeps a float change on a filtered adjustment list', async () => {
      const registry = createSalesCalculationRegistry()
      registry.registerTotalsCalculator(({ current }) => ({
        ...current,
        adjustments: current.adjustments
          .filter((adjustment) => adjustment.id !== 'adj-a')
          .map((adjustment) => ({ ...adjustment, amountNet: 0, amountGross: 0 })),
      }))

      const result = await registry.calculateDocument({
        documentKind: 'order',
        lines: [productLine('line-1', 20)],
        adjustments: [
          { id: 'adj-a', scope: 'order', kind: 'discount', amountNet: 5, amountGross: 5 },
          { id: 'adj-b', scope: 'order', kind: 'discount', amountNet: 9.99, amountGross: 9.99 },
        ],
        context: usdContext,
      })

      expect(result.adjustments).toHaveLength(1)
      expect(result.adjustments[0]).toMatchObject({ id: 'adj-b', amountNetExact: '0', amountGrossExact: '0' })
    })

    it('keeps a float change on a reordered line', async () => {
      const registry = createSalesCalculationRegistry()
      registry.registerTotalsCalculator(({ current }) => ({
        ...current,
        lines: [{ ...current.lines[1], netAmount: 7 }, current.lines[0]],
      }))

      const result = await registry.calculateDocument({
        documentKind: 'order',
        lines: [productLine('line-1', 1), productLine('line-2', 2)],
        context: usdContext,
      })

      expect(result.lines.map((line) => [line.line.id, line.netAmountExact])).toEqual([
        ['line-2', '7'],
        ['line-1', '1'],
      ])
    })

    it('keeps an exact change on an adjustment shifted by a prepended one', async () => {
      const registry = createSalesCalculationRegistry()
      registry.registerTotalsCalculator(({ current }) => ({
        ...current,
        adjustments: [
          { id: 'adj-c', scope: 'order', kind: 'surcharge', amountNet: 3, amountNetExact: '3' },
          ...current.adjustments.map((adjustment) => ({ ...adjustment, amountNetExact: '8' })),
        ],
      }))

      const result = await registry.calculateDocument({
        documentKind: 'order',
        lines: [productLine('line-1', 20)],
        adjustments: [{ id: 'adj-a', scope: 'order', kind: 'discount', amountNet: 5, amountGross: 5 }],
        context: usdContext,
      })

      expect(result.adjustments.map((adjustment) => [adjustment.id, adjustment.amountNetExact])).toEqual([
        ['adj-c', '3'],
        ['adj-a', '8'],
      ])
    })

    it('falls back to the float when an unpaired item has a stale exact value', async () => {
      const registry = createSalesCalculationRegistry()
      registry.registerTotalsCalculator(({ current }) => ({
        ...current,
        adjustments: [
          { scope: 'order', kind: 'discount', amountNet: 4, amountNetExact: '9.99' },
          { scope: 'order', kind: 'surcharge', amountNet: 2, amountNetExact: '2' },
        ],
      }))

      const result = await registry.calculateDocument({
        documentKind: 'order',
        lines: [productLine('line-1', 20)],
        adjustments: [{ scope: 'order', kind: 'discount', amountNet: 9.99, amountGross: 9.99 }],
        context: usdContext,
      })

      expect(result.adjustments.map((adjustment) => adjustment.amountNetExact)).toEqual(['4', '2'])
    })
  })

  describe('pairs idless hook amounts by identity or position', () => {
    const usdContext = { tenantId: 'tenant-1', organizationId: 'org-1', currencyCode: 'USD' }
    const newLine = (unitPriceNet: number): SalesLineSnapshot => ({
      kind: 'product',
      quantity: 1,
      currencyCode: 'USD',
      unitPriceNet,
      taxRate: 0,
    })

    it('keeps legacy float edits when idless lines are reordered', async () => {
      const registry = createSalesCalculationRegistry()
      registry.registerTotalsCalculator(({ current }) => ({
        ...current,
        lines: [{ ...current.lines[1], netAmount: 7 }, current.lines[0]],
      }))
      const result = await registry.calculateDocument({
        documentKind: 'quote',
        lines: [newLine(1), newLine(2)],
        context: usdContext,
      })
      expect(result.lines.map((line) => line.netAmountExact)).toEqual(['7', '1'])
    })

    it('keeps exact-only edits when idless lines are filtered and reordered', async () => {
      const registry = createSalesCalculationRegistry()
      registry.registerTotalsCalculator(({ current }) => ({
        ...current,
        lines: [{ ...current.lines[2], netAmountExact: '3.0001' }, current.lines[0]],
      }))
      const result = await registry.calculateDocument({
        documentKind: 'quote',
        lines: [newLine(1), newLine(2), newLine(3)],
        context: usdContext,
      })
      expect(result.lines.map((line) => line.netAmountExact)).toEqual(['3.0001', '1'])
      expect(result.lines[0].netAmount).toBe(3.0001)
    })

    it('keeps an exact-only line edit on a document being created', async () => {
      const registry = createSalesCalculationRegistry()
      registry.registerTotalsCalculator(({ current }) => ({
        ...current,
        lines: current.lines.map((line, index) => (index === 0 ? { ...line, netAmountExact: '1.005' } : line)),
      }))

      const result = await registry.calculateDocument({
        documentKind: 'quote',
        lines: [newLine(1), newLine(2)],
        context: usdContext,
      })

      expect(result.lines.map((line) => line.netAmountExact)).toEqual(['1.005', '2'])
      expect(result.lines[0].netAmount).toBe(1.005)
    })

    it('keeps an exact-only adjustment edit on a document being created', async () => {
      const registry = createSalesCalculationRegistry()
      registry.registerTotalsCalculator(({ current }) => ({
        ...current,
        adjustments: current.adjustments.map((adjustment) => ({ ...adjustment, amountNetExact: '5.0001' })),
      }))

      const result = await registry.calculateDocument({
        documentKind: 'order',
        lines: [newLine(20)],
        adjustments: [{ scope: 'order', kind: 'discount', amountNet: 5, amountGross: 5 }],
        context: usdContext,
      })

      expect(result.adjustments[0].amountNetExact).toBe('5.0001')
    })

    it('keeps a float-only edit over a stale exact value on a document being created', async () => {
      const registry = createSalesCalculationRegistry()
      registry.registerTotalsCalculator(({ current }) => ({
        ...current,
        adjustments: [{ scope: 'order', kind: 'discount', amountNet: 4, amountNetExact: '9.99' }],
      }))

      const result = await registry.calculateDocument({
        documentKind: 'order',
        lines: [newLine(20)],
        adjustments: [{ scope: 'order', kind: 'discount', amountNet: 9.99, amountGross: 9.99 }],
        context: usdContext,
      })

      expect(result.adjustments[0].amountNetExact).toBe('4')
    })

    it('pairs by line identity once the hook changes the item count', async () => {
      const registry = createSalesCalculationRegistry()
      registry.registerTotalsCalculator(({ current }) => ({
        ...current,
        lines: current.lines.slice(1).map((line) => ({ ...line, netAmountExact: '2.005' })),
      }))

      const result = await registry.calculateDocument({
        documentKind: 'quote',
        lines: [newLine(1), newLine(2)],
        context: usdContext,
      })

      expect(result.lines.map((line) => line.netAmountExact)).toEqual(['2.005'])
    })
  })
})
