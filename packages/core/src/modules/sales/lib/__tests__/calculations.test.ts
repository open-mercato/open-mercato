import {
  calculateDocumentTotals,
  registerSalesTotalsCalculator,
} from '../calculations'
import type { SalesAdjustmentDraft, SalesLineSnapshot } from '../types'

const baseContext = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  currencyCode: 'USD',
}

describe('calculateDocumentTotals', () => {
  it('calculates order line totals and aggregates adjustments', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 2,
        currencyCode: 'USD',
        unitPriceNet: 10,
        taxRate: 20,
      },
      {
        kind: 'product',
        quantity: 1,
        currencyCode: 'USD',
        unitPriceGross: 12,
        discountPercent: 10,
        taxRate: 20,
      },
    ]
    const adjustments: SalesAdjustmentDraft[] = [
      {
        scope: 'order',
        kind: 'discount',
        amountNet: 5,
        amountGross: 5,
        currencyCode: 'USD',
      },
      {
        scope: 'order',
        kind: 'shipping',
        rate: 10,
        currencyCode: 'USD',
        metadata: { taxRateValue: 20 },
      },
    ]

    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments,
      context: { ...baseContext, metadata: {} },
    })

    expect(result.lines).toHaveLength(2)
    expect(result.lines[0]).toMatchObject({
      netAmount: 20,
      grossAmount: 24,
      taxAmount: 4,
      discountAmount: 0,
    })
    expect(result.lines[1].netAmount).toBeCloseTo(9, 4)
    expect(result.lines[1].grossAmount).toBeCloseTo(10.8, 4)
    expect(result.lines[1].discountAmount).toBeCloseTo(1, 4)

    const shippingAdj = result.adjustments.find((adj) => adj.kind === 'shipping')
    expect(shippingAdj?.amountNet).toBeCloseTo(2.9, 4)
    expect(shippingAdj?.amountGross).toBeCloseTo(3.48, 4)

    expect(result.totals.subtotalNetAmount).toBeCloseTo(26.9, 4)
    expect(result.totals.subtotalGrossAmount).toBeCloseTo(33.28, 4)
    expect(result.totals.discountTotalAmount).toBeCloseTo(6, 4)
    expect(result.totals.taxTotalAmount).toBeCloseTo(6.38, 4)
    expect(result.totals.shippingNetAmount).toBeCloseTo(2.9, 4)
    expect(result.totals.shippingGrossAmount).toBeCloseTo(3.48, 4)
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(33.28, 4)
    expect(result.totals.outstandingAmount).toBeCloseTo(33.28, 4)
  })

  it('calculates quote totals per line with discounts', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 3,
        currencyCode: 'USD',
        unitPriceNet: 15,
        discountPercent: 10,
        taxRate: 0,
      },
    ]

    const result = await calculateDocumentTotals({
      documentKind: 'quote',
      lines,
      adjustments: [],
      context: { ...baseContext, metadata: {} },
    })

    expect(result.lines[0].netAmount).toBeCloseTo(40.5, 4)
    expect(result.lines[0].discountAmount).toBeCloseTo(4.5, 4)
    expect(result.totals.subtotalNetAmount).toBeCloseTo(40.5, 4)
    expect(result.totals.subtotalGrossAmount).toBeCloseTo(40.5, 4)
    expect(result.totals.discountTotalAmount).toBeCloseTo(4.5, 4)
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(40.5, 4)
  })

  it('keeps manual adjustment amounts when rate defaults to zero', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 1,
        currencyCode: 'USD',
        unitPriceNet: 10,
        taxRate: 0,
      },
    ]

    const adjustments: SalesAdjustmentDraft[] = [
      {
        scope: 'order',
        kind: 'shipping',
        rate: 0,
        amountNet: 9.9,
        amountGross: 9.9,
        currencyCode: 'USD',
        metadata: { manualOverride: true },
      },
    ]

    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments,
      context: { ...baseContext, metadata: {} },
    })

    const shipping = result.adjustments.find((entry) => entry.kind === 'shipping')
    expect(shipping?.amountNet).toBeCloseTo(9.9, 4)
    expect(shipping?.amountGross).toBeCloseTo(9.9, 4)
    expect(result.totals.shippingNetAmount).toBeCloseTo(9.9, 4)
    expect(result.totals.shippingGrossAmount).toBeCloseTo(9.9, 4)
  })

  it('preserves existing payment totals when recalculating order amounts', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 2,
        currencyCode: 'USD',
        unitPriceGross: 50,
        taxRate: 0,
      },
    ]

    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments: [],
      context: { ...baseContext, metadata: {} },
      existingTotals: { paidTotalAmount: 25, refundedTotalAmount: 5 },
    })

    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(100, 4)
    expect(result.totals.paidTotalAmount).toBe(25)
    expect(result.totals.refundedTotalAmount).toBe(5)
    expect(result.totals.outstandingAmount).toBeCloseTo(80, 4)
  })

  it('supports overriding payment-aware totals via calculators', async () => {
    const unregister = registerSalesTotalsCalculator(({ current, context }) => {
      const payments = (context.metadata as any)?.payments ?? {}
      const paid = Number(payments.paid ?? 0)
      const refunded = Number(payments.refunded ?? 0)
      const outstanding = Math.max(current.totals.grandTotalGrossAmount - paid + refunded, 0)
      return {
        ...current,
        totals: {
          ...current.totals,
          paidTotalAmount: paid,
          refundedTotalAmount: refunded,
          outstandingAmount: outstanding,
        },
      }
    })

    try {
      const result = await calculateDocumentTotals({
        documentKind: 'order',
        lines: [
          {
            kind: 'product',
            quantity: 1,
            currencyCode: 'USD',
            unitPriceNet: 100,
            taxRate: 0,
          },
        ],
        context: { ...baseContext, metadata: { payments: { paid: 40, refunded: 5 } } },
      })

      expect(result.totals.grandTotalGrossAmount).toBeCloseTo(100, 4)
      expect(result.totals.paidTotalAmount).toBe(40)
      expect(result.totals.refundedTotalAmount).toBe(5)
      expect(result.totals.outstandingAmount).toBeCloseTo(65, 4)
    } finally {
      unregister()
    }
  })
})
