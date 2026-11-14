jest.mock('@open-mercato/shared/lib/logger', () => {
  const warn = jest.fn()
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn, child: jest.fn() }
  logger.child.mockReturnValue(logger)
  return { mockLoggerWarn: warn, createLogger: () => logger }
})

const { mockLoggerWarn } = jest.requireMock('@open-mercato/shared/lib/logger') as {
  mockLoggerWarn: jest.Mock
}

import {
  calculateDocumentTotals,
  registerSalesLineCalculator,
  registerSalesTotalsCalculator,
} from '../calculations'
import { ensureProviderTotalsCalculator } from '../providers/totals'
import { registerPaymentProvider, registerShippingProvider } from '../providers/registry'
import type { SalesDocumentAmounts, SalesLineSnapshot } from '../types'

const baseContext = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  currencyCode: 'USD',
}

// A source that authors prices in gross: 3 × 4.33 net is 12.99, but the source's
// own line net is 12.98 and its header net disagrees with the sum of its lines
// because it rounds VAT per rate group. Neither figure is derivable from the
// other, which is the whole reason the mode exists.
const externalLine: SalesLineSnapshot = {
  kind: 'product',
  quantity: 3,
  currencyCode: 'USD',
  unitPriceNet: 4.33,
  taxRate: 23,
  taxAmount: 2.99,
  totalNetAmount: 12.98,
  totalGrossAmount: 15.97,
  amountsMode: 'external',
}

const suppliedTotals: Partial<SalesDocumentAmounts> = {
  subtotalNetAmount: 12.97,
  subtotalGrossAmount: 15.96,
  discountTotalAmount: 0.01,
  taxTotalAmount: 2.99,
  shippingNetAmount: 0,
  shippingGrossAmount: 0,
  surchargeTotalAmount: 0,
  grandTotalNetAmount: 12.97,
  grandTotalGrossAmount: 15.96,
}

function externalDocument(overrides: Partial<Parameters<typeof calculateDocumentTotals>[0]> = {}) {
  return calculateDocumentTotals({
    documentKind: 'order',
    lines: [externalLine],
    context: { ...baseContext, metadata: {} },
    totalsMode: 'external',
    suppliedTotals,
    ...overrides,
  })
}

describe('external line amounts', () => {
  it.each([
    ['a discounted line', { discountPercent: 15 }],
    ['a per-unit discount amount', { discountAmount: 1 }],
    ['no discount signals at all', {}],
    ['a unit price that contradicts the total', { unitPriceNet: 99 }],
  ])('returns the supplied net, gross and tax verbatim with %s', async (_label, overrides) => {
    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ ...externalLine, ...overrides }],
      context: { ...baseContext, metadata: {} },
      totalsMode: 'external',
      suppliedTotals,
    })

    expect(result.lines[0]).toMatchObject({
      netAmount: 12.98,
      grossAmount: 15.97,
      taxAmount: 2.99,
    })
  })

  it('derives the discount as the signed gap to unitPriceNet × quantity', async () => {
    const result = await externalDocument()

    // 4.33 × 3 = 12.99, supplied net 12.98 ⇒ a one-minor-unit discount.
    expect(result.lines[0].discountAmount).toBeCloseTo(0.01, 4)
  })

  it('expresses a markup as a negative discount, with neither clamp applied', async () => {
    const markupLine: SalesLineSnapshot = {
      ...externalLine,
      unitPriceNet: 4,
      totalNetAmount: 13,
      totalGrossAmount: 15.99,
    }

    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [markupLine],
      context: { ...baseContext, metadata: {} },
      totalsMode: 'external',
      suppliedTotals,
    })

    expect(result.lines[0].netAmount).toBeCloseTo(13, 4)
    expect(result.lines[0].discountAmount).toBeCloseTo(-1, 4)
  })

  it('is idempotent — recalculating a calculated external line changes nothing', async () => {
    const first = await externalDocument()
    const second = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [
        {
          ...externalLine,
          totalNetAmount: first.lines[0].netAmount,
          totalGrossAmount: first.lines[0].grossAmount,
          taxAmount: first.lines[0].taxAmount,
          discountAmount: first.lines[0].discountAmount,
        },
      ],
      context: { ...baseContext, metadata: {} },
      totalsMode: 'external',
      suppliedTotals,
    })

    expect(second.lines[0]).toMatchObject({
      netAmount: first.lines[0].netAmount,
      grossAmount: first.lines[0].grossAmount,
      taxAmount: first.lines[0].taxAmount,
      discountAmount: first.lines[0].discountAmount,
    })
    expect(second.totals).toEqual(first.totals)
  })

  it('does not fire the supplied-net reconciliation warning (#5644)', async () => {
    mockLoggerWarn.mockClear()

    // 12.98 is not what the engine would compute from 4.33 × 3, which is exactly
    // the divergence that warning exists to surface on a computed line. Here it
    // is the caller's assertion, so there is nothing to reconcile — and the
    // suppression is positional (§ 3 returns above it), so it is asserted
    // against the logger rather than assumed from reading the code.
    await externalDocument()

    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('still fires that warning for the same numbers on a computed line', async () => {
    mockLoggerWarn.mockClear()

    await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ ...externalLine, amountsMode: 'computed' }],
      context: { ...baseContext, metadata: {} },
    })

    expect(mockLoggerWarn).toHaveBeenCalled()
  })

  it('leaves a line with no mode on the derivation path', async () => {
    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ ...externalLine, amountsMode: undefined }],
      context: { ...baseContext, metadata: {} },
    })

    // 4.33 × 3 = 12.99, not the 12.98 the source asserted.
    expect(result.lines[0].netAmount).toBeCloseTo(12.99, 4)
  })
})

describe('external document totals', () => {
  it('keeps a supplied header that disagrees with the sum of its lines', async () => {
    const result = await externalDocument()

    expect(result.lines[0].netAmount).toBeCloseTo(12.98, 4)
    expect(result.totals.subtotalNetAmount).toBeCloseTo(12.97, 4)
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(15.96, 4)
  })

  it('derives outstanding from the supplied gross, not from the line rollup', async () => {
    const result = await externalDocument({
      existingTotals: { paidTotalAmount: 5, refundedTotalAmount: 1 },
    })

    expect(result.totals.paidTotalAmount).toBeCloseTo(5, 4)
    expect(result.totals.refundedTotalAmount).toBeCloseTo(1, 4)
    expect(result.totals.outstandingAmount).toBeCloseTo(15.96 - 5 + 1, 4)
  })

  it('defaults an omitted optional header field to zero rather than to the rollup', async () => {
    const result = await externalDocument({
      suppliedTotals: { ...suppliedTotals, shippingNetAmount: undefined },
    })

    expect(result.totals.shippingNetAmount).toBe(0)
  })
})

describe('the calculator registries on external rows', () => {
  it('restores the supplied header after a totals calculator rewrote it', async () => {
    const unregister = registerSalesTotalsCalculator(async ({ current }) => ({
      ...current,
      totals: { ...current.totals, grandTotalGrossAmount: 999, subtotalNetAmount: 999 },
    }))

    try {
      const result = await externalDocument({
        existingTotals: { paidTotalAmount: 0, refundedTotalAmount: 0 },
      })

      expect(result.totals.grandTotalGrossAmount).toBeCloseTo(15.96, 4)
      expect(result.totals.subtotalNetAmount).toBeCloseTo(12.97, 4)
      expect(result.totals.outstandingAmount).toBeCloseTo(15.96, 4)
    } finally {
      unregister()
    }
  })

  it('restores a supplied line amount after a line calculator rewrote it', async () => {
    const seen: string[] = []
    const unregister = registerSalesLineCalculator(async ({ current }) => {
      seen.push('ran')
      return { ...current, netAmount: 999, grossAmount: 999, taxAmount: 999 }
    })

    try {
      const result = await externalDocument()

      // The hook still runs — the extension point is not silently disabled —
      // it just cannot move a figure the caller asserted.
      expect(seen).toEqual(['ran'])
      expect(result.lines[0]).toMatchObject({
        netAmount: 12.98,
        grossAmount: 15.97,
        taxAmount: 2.99,
      })
    } finally {
      unregister()
    }
  })

  it('lets a line calculator keep changing a computed line', async () => {
    const unregister = registerSalesLineCalculator(async ({ current }) => ({
      ...current,
      netAmount: 999,
    }))

    try {
      const result = await calculateDocumentTotals({
        documentKind: 'order',
        lines: [{ ...externalLine, amountsMode: 'computed' }],
        context: { ...baseContext, metadata: {} },
      })

      expect(result.lines[0].netAmount).toBe(999)
    } finally {
      unregister()
    }
  })
})

describe("core's own provider totals calculator", () => {
  const shippingMethod = { id: 'ship-1', code: 'STD', providerKey: 'test-flat-rate' }
  const paymentMethod = { id: 'pay-1', code: 'COD', providerKey: 'test-cod-fee' }

  beforeAll(() => {
    registerShippingProvider({
      key: 'test-flat-rate',
      label: 'Flat rate',
      calculate: () => ({ adjustments: [{ label: 'Shipping', amountNet: 10, amountGross: 12.3 }] }),
    })
    registerPaymentProvider({
      key: 'test-cod-fee',
      label: 'Cash on delivery',
      calculate: () => ({ adjustments: [{ label: 'COD fee', amountNet: 2, amountGross: 2.46 }] }),
    })
    ensureProviderTotalsCalculator()
  })

  it('generates no adjustment and moves no total on an external document', async () => {
    const result = await externalDocument({
      context: { ...baseContext, metadata: { shippingMethod, paymentMethod } },
    })

    expect(result.adjustments).toEqual([])
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(15.96, 4)
    expect(result.totals.shippingNetAmount).toBe(0)
  })

  it('still generates provider adjustments on a computed document', async () => {
    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ ...externalLine, amountsMode: 'computed' }],
      context: { ...baseContext, metadata: { shippingMethod, paymentMethod } },
    })

    expect(result.adjustments.length).toBeGreaterThan(0)
    expect(result.totals.shippingNetAmount).toBeCloseTo(10, 4)
  })
})
