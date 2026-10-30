jest.mock('@open-mercato/shared/lib/logger', () => {
  const globalStore = globalThis as typeof globalThis & { __omTestLoggerMock?: Record<string, jest.Mock> }
  if (!globalStore.__omTestLoggerMock) {
    const mocked: Record<string, jest.Mock> = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    }
    mocked.child.mockImplementation(() => mocked)
    globalStore.__omTestLoggerMock = mocked
  }
  const mocked = globalStore.__omTestLoggerMock
  return { createLogger: jest.fn(() => mocked) }
})

const mockLogger = jest.requireMock('@open-mercato/shared/lib/logger').createLogger('test') as {
  warn: jest.Mock
}

import {
  calculateDocumentTotals,
  calculateLine,
  rebuildDocumentResult,
  registerSalesTotalsCalculator,
} from '../calculations'
import { mapOrderLineEntityToSnapshot } from '../lineSnapshots'
import type { SalesAdjustmentDraft, SalesLineSnapshot } from '../types'
import type { SalesOrderLine } from '../../data/entities'

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

  it('treats positive return amounts as negative so they never inflate the grand total (issue #1705)', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 1,
        currencyCode: 'USD',
        unitPriceNet: 1,
        taxRate: 0,
      },
    ]
    const adjustments: SalesAdjustmentDraft[] = [
      {
        scope: 'order',
        kind: 'return',
        amountNet: 1,
        amountGross: 1,
        currencyCode: 'USD',
      },
    ]

    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments,
      context: { ...baseContext, metadata: {} },
    })

    expect(result.totals.grandTotalGrossAmount).toBeLessThanOrEqual(1)
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(0, 4)
    expect(result.totals.subtotalNetAmount).toBeCloseTo(0, 4)
  })

  it('reduces grand total for line-scoped return (credit) adjustments', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 2,
        currencyCode: 'USD',
        unitPriceNet: 10,
        taxRate: 0,
        totalGrossAmount: 24,
      },
    ]
    const adjustments: SalesAdjustmentDraft[] = [
      {
        scope: 'line',
        kind: 'return',
        amountNet: -12,
        amountGross: -12,
        currencyCode: 'USD',
      },
    ]

    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments,
      context: { ...baseContext, metadata: {} },
    })

    expect(result.totals.subtotalNetAmount).toBeCloseTo(8, 4)
    expect(result.totals.subtotalGrossAmount).toBeCloseTo(12, 4)
    expect(result.totals.grandTotalNetAmount).toBeCloseTo(8, 4)
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(12, 4)
  })

  it('normalizes signs for discount/surcharge/shipping/tax so negatives never invert the grand total (issue #1905)', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 1,
        currencyCode: 'USD',
        unitPriceNet: 100,
        taxRate: 0,
      },
    ]
    const negativeAdjustments: SalesAdjustmentDraft[] = [
      {
        scope: 'order',
        kind: 'discount',
        amountNet: -20,
        amountGross: -20,
        currencyCode: 'USD',
      },
      {
        scope: 'order',
        kind: 'surcharge',
        amountNet: -5,
        amountGross: -5,
        currencyCode: 'USD',
      },
      {
        scope: 'order',
        kind: 'shipping',
        amountNet: -10,
        amountGross: -10,
        currencyCode: 'USD',
      },
      {
        scope: 'order',
        kind: 'tax',
        amountNet: -3,
        amountGross: -3,
        currencyCode: 'USD',
      },
    ]

    const negativeResult = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments: negativeAdjustments,
      context: { ...baseContext, metadata: {} },
    })

    const positiveAdjustments: SalesAdjustmentDraft[] = negativeAdjustments.map(
      (adj) => ({ ...adj, amountNet: Math.abs(adj.amountNet!), amountGross: Math.abs(adj.amountGross!) }),
    )
    const positiveResult = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments: positiveAdjustments,
      context: { ...baseContext, metadata: {} },
    })

    // Negative amounts must not flip the semantic effect of any kind.
    expect(negativeResult.totals.discountTotalAmount).toBeCloseTo(
      positiveResult.totals.discountTotalAmount,
      4,
    )
    expect(negativeResult.totals.surchargeTotalAmount).toBeCloseTo(
      positiveResult.totals.surchargeTotalAmount,
      4,
    )
    expect(negativeResult.totals.shippingNetAmount).toBeCloseTo(
      positiveResult.totals.shippingNetAmount,
      4,
    )
    expect(negativeResult.totals.shippingGrossAmount).toBeCloseTo(
      positiveResult.totals.shippingGrossAmount,
      4,
    )
    expect(negativeResult.totals.taxTotalAmount).toBeCloseTo(
      positiveResult.totals.taxTotalAmount,
      4,
    )
    expect(negativeResult.totals.grandTotalNetAmount).toBeCloseTo(
      positiveResult.totals.grandTotalNetAmount,
      4,
    )
    expect(negativeResult.totals.grandTotalGrossAmount).toBeCloseTo(
      positiveResult.totals.grandTotalGrossAmount,
      4,
    )

    // Sanity: discount reduces, surcharge/shipping/tax increase.
    // 100 - 20 (discount) + 5 (surcharge net) + 10 (shipping net) = 95 net.
    expect(positiveResult.totals.subtotalNetAmount).toBeCloseTo(95, 4)
    expect(positiveResult.totals.discountTotalAmount).toBeCloseTo(20, 4)
  })

  it('folds custom / operator-defined adjustment kinds into the grand total so it never diverges from its itemization (issue #4052)', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 1,
        currencyCode: 'USD',
        unitPriceNet: 100,
        taxRate: 0,
      },
    ]

    const positiveResult = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments: [
        {
          scope: 'order',
          kind: 'custom',
          label: 'Handling fee',
          amountNet: 15,
          amountGross: 15,
          currencyCode: 'USD',
        },
      ],
      context: { ...baseContext, metadata: {} },
    })

    // A positive custom amount adds to the total (operator-controlled sign).
    expect(positiveResult.totals.grandTotalNetAmount).toBeCloseTo(115, 4)
    expect(positiveResult.totals.grandTotalGrossAmount).toBeCloseTo(115, 4)

    const partialCreditResult = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments: [
        {
          scope: 'order',
          kind: 'custom',
          label: 'Goodwill credit',
          amountNet: -30,
          amountGross: -30,
          currencyCode: 'USD',
        },
      ],
      context: { ...baseContext, metadata: {} },
    })

    // A negative custom amount reduces the total instead of being silently dropped.
    expect(partialCreditResult.totals.grandTotalNetAmount).toBeCloseTo(70, 4)
    expect(partialCreditResult.totals.grandTotalGrossAmount).toBeCloseTo(70, 4)

    const overCreditResult = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments: [
        {
          scope: 'order',
          kind: 'custom',
          label: 'Large credit',
          amountNet: -150,
          amountGross: -150,
          currencyCode: 'USD',
        },
      ],
      context: { ...baseContext, metadata: {} },
    })

    // A credit larger than the order total is reflected faithfully (the grand
    // total equals subtotal + adjustment) rather than leaving the headline
    // unchanged while the adjustment shows in the breakdown.
    expect(overCreditResult.totals.grandTotalNetAmount).toBeCloseTo(-50, 4)
    expect(overCreditResult.totals.grandTotalGrossAmount).toBeCloseTo(-50, 4)
    // Amount due can never go negative.
    expect(overCreditResult.totals.outstandingAmount).toBeCloseTo(0, 4)
  })

  it('derives line tax from the net/gross delta when the rate is missing but gross embeds tax (issue #2457)', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 1,
        currencyCode: 'USD',
        unitPriceNet: 100,
        unitPriceGross: 123,
        totalNetAmount: 100,
        totalGrossAmount: 123,
      },
    ]

    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments: [],
      context: { ...baseContext, metadata: {} },
    })

    expect(result.totals.subtotalNetAmount).toBeCloseTo(100, 4)
    expect(result.totals.subtotalGrossAmount).toBeCloseTo(123, 4)
    expect(result.totals.taxTotalAmount).toBeCloseTo(23, 4)
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(123, 4)
  })

  it('does not invent tax when gross equals net (issue #2457 guard)', async () => {
    const lines: SalesLineSnapshot[] = [
      {
        kind: 'product',
        quantity: 1,
        currencyCode: 'USD',
        unitPriceNet: 100,
        unitPriceGross: 100,
        totalNetAmount: 100,
        totalGrossAmount: 100,
      },
    ]

    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines,
      adjustments: [],
      context: { ...baseContext, metadata: {} },
    })

    expect(result.totals.taxTotalAmount).toBeCloseTo(0, 4)
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(100, 4)
  })

  it('preserves payment totals when a totals calculator rebuilds the result (issue #2455)', async () => {
    // Mirrors the provider totals calculator, which rebuilds the document from
    // lines+adjustments via rebuildDocumentResult and would otherwise reset
    // paid/refunded/outstanding to a pre-payment snapshot.
    const unregister = registerSalesTotalsCalculator(({ documentKind, lines, current }) =>
      rebuildDocumentResult({
        documentKind,
        currencyCode: current.currencyCode,
        lines,
        adjustments: current.adjustments,
        metadata: current.metadata,
      }),
    )

    try {
      const result = await calculateDocumentTotals({
        documentKind: 'order',
        lines: [
          {
            kind: 'product',
            quantity: 1,
            currencyCode: 'USD',
            unitPriceNet: 1000,
            taxRate: 0,
          },
        ],
        adjustments: [],
        context: { ...baseContext, metadata: {} },
        existingTotals: { paidTotalAmount: 1000, refundedTotalAmount: 0 },
      })

      expect(result.totals.grandTotalGrossAmount).toBeCloseTo(1000, 4)
      expect(result.totals.paidTotalAmount).toBeCloseTo(1000, 4)
      expect(result.totals.refundedTotalAmount).toBeCloseTo(0, 4)
      expect(result.totals.outstandingAmount).toBeCloseTo(0, 4)
    } finally {
      unregister()
    }
  })

  it('recomputes outstanding against the post-calculation grand total (issue #2455)', async () => {
    // A totals calculator that adds a surcharge changes the grand total; the
    // preserved payment totals must produce outstanding against the new total.
    const unregister = registerSalesTotalsCalculator(({ documentKind, lines, current }) =>
      rebuildDocumentResult({
        documentKind,
        currencyCode: current.currencyCode,
        lines,
        adjustments: [
          ...current.adjustments,
          { scope: 'order', kind: 'surcharge', amountNet: 100, amountGross: 100, currencyCode: 'USD' },
        ],
        metadata: current.metadata,
      }),
    )

    try {
      const result = await calculateDocumentTotals({
        documentKind: 'order',
        lines: [
          {
            kind: 'product',
            quantity: 1,
            currencyCode: 'USD',
            unitPriceNet: 1000,
            taxRate: 0,
          },
        ],
        adjustments: [],
        context: { ...baseContext, metadata: {} },
        existingTotals: { paidTotalAmount: 1000, refundedTotalAmount: 0 },
      })

      expect(result.totals.grandTotalGrossAmount).toBeCloseTo(1100, 4)
      expect(result.totals.paidTotalAmount).toBeCloseTo(1000, 4)
      expect(result.totals.outstandingAmount).toBeCloseTo(100, 4)
    } finally {
      unregister()
    }
  })
})

describe('buildBaseLineResult net amount reconciliation (issue #5644)', () => {
  afterEach(() => {
    mockLogger.warn.mockClear()
  })

  const callerLine = (overrides: Partial<SalesLineSnapshot> = {}): SalesLineSnapshot => ({
    kind: 'product',
    quantity: 2,
    currencyCode: 'USD',
    unitPriceNet: 100,
    ...overrides,
  })

  it('keeps the computed net amount and warns when a supplied totalNetAmount diverges', async () => {
    const result = await calculateLine({
      documentKind: 'order',
      line: callerLine({ id: 'line-42', productId: 'product-7', totalNetAmount: 150 }),
      context: baseContext,
    })

    expect(result.netAmount).toBeCloseTo(200, 4)
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Sales line totalNetAmount does not match the computed net amount; the computed value is used',
      // The two ids are the whole operational value of the log line — which
      // line is wrong — so they are pinned, not just the amounts.
      {
        lineId: 'line-42',
        productId: 'product-7',
        suppliedTotalNetAmount: 150,
        computedNetAmount: 200,
      },
    )
  })

  it('does not warn when the supplied totalNetAmount matches the computed net amount', async () => {
    const result = await calculateLine({
      documentKind: 'order',
      line: callerLine({ totalNetAmount: 200 }),
      context: baseContext,
    })

    expect(result.netAmount).toBeCloseTo(200, 4)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('does not warn when totalNetAmount is not supplied', async () => {
    await calculateLine({
      documentKind: 'order',
      line: callerLine(),
      context: baseContext,
    })

    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('tolerates a caller rounding money to two decimals against a four-decimal net', async () => {
    // 3 x 33.3285 = 99.9855, which a caller posting money reports as 99.99.
    // That is rounding, not a discrepancy, and must not read as one.
    await calculateLine({
      documentKind: 'order',
      line: callerLine({ quantity: 3, unitPriceNet: 33.3285, totalNetAmount: 99.99 }),
      context: baseContext,
    })

    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('still warns for a divergence just outside the rounding tolerance', async () => {
    await calculateLine({
      documentKind: 'order',
      line: callerLine({ quantity: 1, unitPriceNet: 100, totalNetAmount: 100.006 }),
      context: baseContext,
    })

    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
  })

  it('warns rather than silently swallowing a non-finite supplied value', async () => {
    // The prior fallback-to-computed reading made this compare equal and log
    // nothing — the exact silent discard #5644 is about.
    const result = await calculateLine({
      documentKind: 'order',
      line: callerLine({ id: 'line-9', totalNetAmount: Number.NaN }),
      context: baseContext,
    })

    expect(result.netAmount).toBeCloseTo(200, 4)
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Sales line totalNetAmount is not a finite number; the computed value is used',
      expect.objectContaining({ lineId: 'line-9', computedNetAmount: 200 }),
    )
  })

  it('stays silent for a rehydrated line whose stored net the discount contract is healing', async () => {
    // #5640 lets a row whose discount the old engine dropped heal on the next
    // recalculation, so the stored net is *supposed* to diverge here. Warning
    // would fire per line, per recalculation, forever.
    const snapshot = mapOrderLineEntityToSnapshot({
      id: 'line-legacy',
      lineNumber: 1,
      kind: 'product',
      productId: null,
      productVariantId: null,
      name: 'Widget',
      description: null,
      comment: null,
      quantity: '3',
      quantityUnit: null,
      normalizedQuantity: null,
      normalizedUnit: null,
      uomSnapshot: null,
      currencyCode: 'USD',
      unitPriceNet: '85',
      unitPriceGross: '85',
      discountAmount: '0',
      discountPercent: '5',
      taxRate: '0',
      taxAmount: null,
      totalNetAmount: '255',
      totalGrossAmount: '255',
      configuration: null,
      promotionCode: null,
      metadata: null,
      customFieldSetId: null,
    } as unknown as SalesOrderLine)

    const result = await calculateLine({
      documentKind: 'order',
      line: snapshot,
      context: baseContext,
    })

    expect(result.netAmount).toBeCloseTo(242.25, 4)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('stays silent for the NOT NULL DEFAULT zero a persisted row carries', async () => {
    const snapshot: SalesLineSnapshot = {
      kind: 'product',
      quantity: 2,
      currencyCode: 'USD',
      unitPriceNet: 100,
      totalNetAmount: 0,
      totalsFromStoredRow: true,
    }

    await calculateLine({ documentKind: 'order', line: snapshot, context: baseContext })

    expect(mockLogger.warn).not.toHaveBeenCalled()
  })
})

describe('line discount contract (spec 2026-08-07)', () => {
  const calcLine = async (line: Omit<SalesLineSnapshot, 'kind' | 'currencyCode'>) => {
    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ kind: 'product', currencyCode: 'USD', ...line } as SalesLineSnapshot],
      adjustments: [],
      context: { ...baseContext, metadata: {} },
    })
    return result.lines[0]
  }

  it('reads a stored line-total discount as a line total rather than a per-unit rate', async () => {
    const line = await calcLine({
      quantity: 3,
      unitPriceNet: 85,
      discountAmount: 12.75,
      discountAmountFromStoredRow: true,
      taxRate: 0,
    })

    expect(line.discountAmount).toBeCloseTo(12.75, 4)
    expect(line.netAmount).toBeCloseTo(242.25, 4)
  })

  it('multiplies a caller-supplied amount by quantity, preserving the documented API meaning', async () => {
    const line = await calcLine({ quantity: 60, unitPriceNet: 50, discountAmount: 5, taxRate: 0 })

    expect(line.discountAmount).toBeCloseTo(300, 4)
    expect(line.netAmount).toBeCloseTo(2700, 4)
  })

  it('honours an explicit line basis from a caller without multiplying by quantity', async () => {
    const line = await calcLine({
      quantity: 60,
      unitPriceNet: 50,
      discountAmount: 5,
      discountAmountBasis: 'line',
      taxRate: 0,
    })

    expect(line.discountAmount).toBeCloseTo(5, 4)
    expect(line.netAmount).toBeCloseTo(2995, 4)
  })

  it('treats an explicit unit basis the same as an omitted one', async () => {
    const explicit = await calcLine({
      quantity: 4,
      unitPriceNet: 20,
      discountAmount: 3,
      discountAmountBasis: 'unit',
      taxRate: 0,
    })
    const omitted = await calcLine({ quantity: 4, unitPriceNet: 20, discountAmount: 3, taxRate: 0 })

    expect(explicit.discountAmount).toBeCloseTo(12, 4)
    expect(omitted.discountAmount).toBeCloseTo(explicit.discountAmount as number, 4)
  })

  it('lets the percentage win over a stored amount, so a re-inflated row heals itself', async () => {
    const line = await calcLine({
      quantity: 3,
      unitPriceNet: 85,
      discountAmount: 255,
      discountPercent: 5,
      discountAmountFromStoredRow: true,
      taxRate: 0,
    })

    expect(line.discountAmount).toBeCloseTo(12.75, 4)
    expect(line.netAmount).toBeCloseTo(242.25, 4)
  })

  it('restores a dropped discount when the stored amount is zero but a percentage remains', async () => {
    const line = await calcLine({
      quantity: 60,
      unitPriceNet: 50,
      discountAmount: 0,
      discountPercent: 10,
      discountAmountFromStoredRow: true,
      taxRate: 0,
    })

    expect(line.discountAmount).toBeCloseTo(300, 4)
    expect(line.netAmount).toBeCloseTo(2700, 4)
  })

  it('applies the percentage when a caller sends discountAmount 0 alongside it (decision D3)', async () => {
    const line = await calcLine({ quantity: 5, unitPriceNet: 40, discountAmount: 0, discountPercent: 10, taxRate: 0 })

    expect(line.discountAmount).toBeCloseTo(20, 4)
    expect(line.netAmount).toBeCloseTo(180, 4)
  })

  it('applies no discount when neither a percentage nor an amount is supplied', async () => {
    const line = await calcLine({ quantity: 5, unitPriceNet: 40, discountAmount: 0, discountPercent: 0, taxRate: 0 })

    expect(line.discountAmount).toBeCloseTo(0, 4)
    expect(line.netAmount).toBeCloseTo(200, 4)
  })

  it('clamps a stored discount that exceeds the line subtotal instead of driving net negative', async () => {
    const line = await calcLine({
      quantity: 2,
      unitPriceNet: 10,
      discountAmount: 500,
      discountAmountFromStoredRow: true,
      taxRate: 0,
    })

    expect(line.discountAmount).toBeCloseTo(20, 4)
    expect(line.netAmount).toBeCloseTo(0, 4)
  })

  it('stays idempotent when the persisted discount is fed back in five times over', async () => {
    let storedDiscount = 12.75
    let storedNet = 242.25

    for (let pass = 0; pass < 5; pass += 1) {
      const line = await calcLine({
        quantity: 3,
        unitPriceNet: 85,
        discountAmount: storedDiscount,
        discountAmountFromStoredRow: true,
        taxRate: 0,
      })
      storedDiscount = line.discountAmount as number
      storedNet = line.netAmount as number
    }

    expect(storedDiscount).toBeCloseTo(12.75, 4)
    expect(storedNet).toBeCloseTo(242.25, 4)
  })

  it.each([
    { quantity: 1, unitPriceNet: 85, discountPercent: 5, expectedDiscount: 4.25 },
    { quantity: 3, unitPriceNet: 85, discountPercent: 5, expectedDiscount: 12.75 },
    { quantity: 4, unitPriceNet: 25, discountPercent: 10, expectedDiscount: 10 },
    { quantity: 60, unitPriceNet: 50, discountPercent: 10, expectedDiscount: 300 },
  ])(
    'recalculating a percentage line ($quantity x $unitPriceNet at $discountPercent%) is idempotent',
    async ({ quantity, unitPriceNet, discountPercent, expectedDiscount }) => {
      const first = await calcLine({ quantity, unitPriceNet, discountPercent, taxRate: 0 })
      const second = await calcLine({
        quantity,
        unitPriceNet,
        discountPercent,
        discountAmount: first.discountAmount,
        discountAmountFromStoredRow: true,
        taxRate: 0,
      })

      expect(first.discountAmount).toBeCloseTo(expectedDiscount, 4)
      expect(second.discountAmount).toBeCloseTo(expectedDiscount, 4)
      expect(second.netAmount).toBeCloseTo(first.netAmount as number, 4)
    },
  )

  it('keeps the document subtotal positive when a discounted multi-unit line is recalculated (issue #3757)', async () => {
    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [
        {
          kind: 'product',
          quantity: 3,
          currencyCode: 'USD',
          unitPriceNet: 85,
          discountAmount: 255,
          discountPercent: 5,
          discountAmountFromStoredRow: true,
          totalGrossAmount: 242.25,
          taxRate: 0,
        },
      ],
      adjustments: [],
      context: { ...baseContext, metadata: {} },
    })

    expect(result.totals.subtotalNetAmount).toBeCloseTo(242.25, 4)
    expect(result.totals.discountTotalAmount).toBeCloseTo(12.75, 4)
    expect(result.totals.grandTotalGrossAmount).toBeGreaterThan(0)
  })
})
