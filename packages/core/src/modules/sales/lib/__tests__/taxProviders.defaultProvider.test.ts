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
  return { createLogger: jest.fn(() => globalStore.__omTestLoggerMock) }
})

import { calculateDocumentTotals } from '../calculations'
import {
  fixedRateTaxProvider,
  tableRatesTaxProvider,
} from '../providers/taxProviders'
import type {
  SalesAdjustmentDraft,
  SalesDocumentCalculationResult,
  SalesLineSnapshot,
} from '../types'
import type {
  TaxCalculationRequest,
  TaxProviderCalculateResult,
  TaxRequestCharge,
  TaxRequestLine,
} from '../providers/types'

const baseContext = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  currencyCode: 'USD',
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  return fallback
}

/**
 * Mirrors what the tax stage assembles, so the assertions below compare the
 * provider against the engine's own output rather than against a re-derivation.
 */
function toRequest(result: SalesDocumentCalculationResult): TaxCalculationRequest {
  const lines: TaxRequestLine[] = result.lines.map((entry, index) => ({
    id: entry.line.id ?? `line-${index + 1}`,
    lineNumber: entry.line.lineNumber ?? index + 1,
    kind: entry.line.kind,
    productId: entry.line.productId ?? null,
    productVariantId: entry.line.productVariantId ?? null,
    sku: null,
    name: entry.line.name ?? null,
    description: entry.line.description ?? null,
    quantity: toNumber(entry.line.quantity, 0),
    unitPriceNet: toNumber(entry.line.unitPriceNet, 0),
    amountNet: entry.netAmount,
    amountGross: entry.grossAmount,
    discountAmount: entry.discountAmount,
    taxAmount: entry.taxAmount,
    taxIncluded: false,
    taxRateId: null,
    taxRate: entry.line.taxRate ?? null,
    taxClassificationCode: null,
    taxCode: null,
    isTaxable: true,
    hsCode: null,
    shipTo: null,
    metadata: {},
  }))

  const charges: TaxRequestCharge[] = result.adjustments
    .filter((adjustment: SalesAdjustmentDraft) => (adjustment.scope ?? 'order') === 'order')
    .map((adjustment, index) => {
      const amountNet = toNumber(adjustment.amountNet, 0)
      const amountGross = toNumber(adjustment.amountGross, amountNet)
      const metadata = (adjustment.metadata ?? {}) as Record<string, unknown>
      const taxRate =
        metadata.taxRate ?? metadata.taxRateValue ?? metadata.tax_rate ?? metadata.tax_rate_value ?? null
      return {
        id: adjustment.id ?? adjustment.calculatorKey ?? `charge-${index + 1}`,
        kind: adjustment.kind,
        code: adjustment.code ?? null,
        label: adjustment.label ?? null,
        amountNet,
        amountGross,
        taxRate: taxRate === null ? null : toNumber(taxRate, 0),
        taxAmount: taxRate === null ? 0 : Math.round((amountGross - amountNet) * 1e4) / 1e4,
        calculatorKey: adjustment.calculatorKey ?? null,
      }
    })

  return {
    documentKind: result.kind,
    documentId: 'doc-1',
    documentNumber: 'DOC-1',
    documentDate: '2026-09-19T00:00:00.000Z',
    intent: 'estimate',
    currencyCode: result.currencyCode,
    organizationId: baseContext.organizationId,
    tenantId: baseContext.tenantId,
    channelId: null,
    customer: null,
    addresses: { shipFrom: null, shipTo: null, billTo: null },
    lines,
    charges,
    totals: {
      subtotalNetAmount: result.totals.subtotalNetAmount,
      discountTotalAmount: result.totals.discountTotalAmount,
      shippingNetAmount: result.totals.shippingNetAmount ?? 0,
    },
    metadata: {},
  }
}

async function runTableRates(
  lines: SalesLineSnapshot[],
  adjustments: SalesAdjustmentDraft[] = []
): Promise<{ engine: SalesDocumentCalculationResult; result: TaxProviderCalculateResult }> {
  const engine = await calculateDocumentTotals({
    documentKind: 'order',
    lines,
    adjustments,
    context: { ...baseContext, metadata: {} },
  })
  const result = (await tableRatesTaxProvider.calculate({
    request: toRequest(engine),
    settings: {},
    credentials: {},
    context: { ...baseContext, metadata: {} },
    signal: new AbortController().signal,
  })) as TaxProviderCalculateResult
  return { engine, result }
}

describe('table-rates tax provider', () => {
  it('reproduces the engine line tax for the rate driven fixture', async () => {
    const { engine, result } = await runTableRates(
      [
        { kind: 'product', quantity: 2, currencyCode: 'USD', unitPriceNet: 10, taxRate: 20 },
        { kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceGross: 12, discountPercent: 10, taxRate: 20 },
      ],
      [
        { scope: 'order', kind: 'discount', amountNet: 5, amountGross: 5, currencyCode: 'USD' },
        { scope: 'order', kind: 'shipping', rate: 10, currencyCode: 'USD', metadata: { taxRateValue: 20 } },
      ]
    )

    expect(result.status).toBe('calculated')
    expect(result.lines.map((line) => line.taxAmount)).toEqual(
      engine.lines.map((line) => line.taxAmount)
    )
    expect(result.lines.map((line) => line.taxableAmount)).toEqual(
      engine.lines.map((line) => line.netAmount)
    )
  })

  it('sums to the document tax total the engine produced', async () => {
    const { engine, result } = await runTableRates(
      [
        { kind: 'product', quantity: 2, currencyCode: 'USD', unitPriceNet: 10, taxRate: 20 },
        { kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceGross: 12, discountPercent: 10, taxRate: 20 },
      ],
      [{ scope: 'order', kind: 'shipping', rate: 10, currencyCode: 'USD', metadata: { taxRateValue: 20 } }]
    )
    expect(result.totals.taxTotal).toBeCloseTo(engine.totals.taxTotalAmount, 4)
  })

  it('returns an explicitly supplied line tax amount verbatim', async () => {
    const { engine, result } = await runTableRates([
      {
        kind: 'product',
        quantity: 3,
        currencyCode: 'USD',
        unitPriceNet: 10,
        taxRate: 20,
        taxAmount: 1.23,
      },
    ])
    expect(engine.lines[0].taxAmount).toBeCloseTo(1.23, 4)
    expect(result.lines[0].taxAmount).toBeCloseTo(1.23, 4)
    expect(result.totals.taxTotal).toBeCloseTo(engine.totals.taxTotalAmount, 4)
  })

  it('carries the gross delta tax the engine derived without a rate (issue #2457)', async () => {
    const { engine, result } = await runTableRates([
      {
        kind: 'product',
        quantity: 1,
        currencyCode: 'USD',
        unitPriceNet: 100,
        unitPriceGross: 123,
        totalNetAmount: 100,
        totalGrossAmount: 123,
      },
    ])
    expect(engine.lines[0].taxAmount).toBeCloseTo(23, 4)
    expect(result.lines[0].taxAmount).toBeCloseTo(23, 4)
    expect(result.totals.taxTotal).toBeCloseTo(23, 4)
  })

  it('invents no tax when the engine found none', async () => {
    const { result } = await runTableRates([
      {
        kind: 'product',
        quantity: 1,
        currencyCode: 'USD',
        unitPriceNet: 100,
        unitPriceGross: 100,
        totalNetAmount: 100,
        totalGrossAmount: 100,
      },
    ])
    expect(result.totals.taxTotal).toBe(0)
    expect(result.lines[0].details).toEqual([])
    expect(result.breakdown).toEqual([])
  })

  it('reports the shipping charge tax portion the engine derived', async () => {
    const { engine, result } = await runTableRates(
      [{ kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 100, taxRate: 20 }],
      [{ scope: 'order', kind: 'shipping', amountNet: 10, amountGross: 12, currencyCode: 'USD', metadata: { taxRateValue: 20 } }]
    )
    expect(result.charges).toHaveLength(1)
    expect(result.charges[0].taxAmount).toBeCloseTo(2, 4)
    expect(result.totals.taxTotal).toBeCloseTo(engine.totals.taxTotalAmount, 4)
  })

  it('groups the breakdown by jurisdiction and rate', async () => {
    const { result } = await runTableRates([
      { kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 100, taxRate: 20 },
      { kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 50, taxRate: 20 },
      { kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 50, taxRate: 7 },
    ])
    expect(result.breakdown).toHaveLength(2)
    const twenty = result.breakdown!.find((entry) => entry.rate === 20)
    expect(twenty?.taxableAmount).toBeCloseTo(150, 4)
    expect(twenty?.taxAmount).toBeCloseTo(30, 4)
  })
})

describe('fixed-rate tax provider', () => {
  async function runFixedRate(
    settings: Record<string, unknown>,
    request?: Partial<TaxCalculationRequest>
  ): Promise<TaxProviderCalculateResult> {
    const engine = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 100, taxRate: 0 }],
      adjustments: [],
      context: { ...baseContext, metadata: {} },
    })
    return (await fixedRateTaxProvider.calculate({
      request: { ...toRequest(engine), ...request },
      settings,
      credentials: {},
      context: { ...baseContext, metadata: {} },
      signal: new AbortController().signal,
    })) as TaxProviderCalculateResult
  }

  it('produces a two jurisdiction breakdown', async () => {
    const result = await runFixedRate({
      rate: 5,
      jurisdictionName: 'State',
      secondaryRate: 2,
      secondaryJurisdictionName: 'City',
    })
    expect(result.status).toBe('calculated')
    expect(result.lines[0].taxAmount).toBeCloseTo(7, 4)
    expect(result.lines[0].details).toHaveLength(2)
    expect(result.breakdown).toHaveLength(2)
    expect(result.breakdown!.map((entry) => entry.jurisdictionName)).toEqual(['State', 'City'])
    expect(result.totals.taxTotal).toBeCloseTo(7, 4)
  })

  it('applies only the primary rate when no secondary is configured', async () => {
    const result = await runFixedRate({ rate: 8.25, jurisdictionName: 'State' })
    expect(result.lines[0].taxAmount).toBeCloseTo(8.25, 4)
    expect(result.lines[0].details).toHaveLength(1)
  })

  it('throws when simulateFailure is throw', async () => {
    await expect(runFixedRate({ rate: 5, simulateFailure: 'throw' })).rejects.toThrow(
      'simulated failure'
    )
  })

  it('waits for the abort signal when simulateFailure is timeout', async () => {
    const controller = new AbortController()
    const engine = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 100, taxRate: 0 }],
      adjustments: [],
      context: { ...baseContext, metadata: {} },
    })
    const pending = fixedRateTaxProvider.calculate({
      request: toRequest(engine),
      settings: { rate: 5, simulateFailure: 'timeout' },
      credentials: {},
      context: { ...baseContext, metadata: {} },
      signal: controller.signal,
    })
    let settled = false
    void Promise.resolve(pending).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    controller.abort()
    await pending
  })

  it('charges nothing for an exempt customer', async () => {
    const result = await runFixedRate(
      { rate: 5, secondaryRate: 2 },
      {
        customer: {
          id: 'cust-1',
          kind: 'company',
          code: 'cust-1',
          displayName: 'Acme Inc',
          taxId: null,
          taxIdType: null,
          exemption: { isExempt: true, code: 'RESALE', certificateNumber: 'CERT-1' },
        },
      }
    )
    expect(result.status).toBe('exempt')
    expect(result.totals.taxTotal).toBe(0)
    expect(result.totals.exemptTotal).toBeCloseTo(result.totals.taxableTotal, 4)
    expect(result.messages?.[0].code).toBe('customer_exempt')
  })

  it('falls back to its defaults for unparseable settings rather than failing', async () => {
    const result = await runFixedRate({ rate: 'not a number' })
    expect(result.status).toBe('calculated')
    expect(result.totals.taxTotal).toBe(0)
  })
})
