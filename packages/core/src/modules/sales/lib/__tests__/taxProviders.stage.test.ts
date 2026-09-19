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

const mockLogger = jest.requireMock('@open-mercato/shared/lib/logger').createLogger('test') as {
  warn: jest.Mock
}

import { calculateDocumentTotals } from '../calculations'
import { ensureProviderTotalsCalculator } from '../providers/totals'
import { registerDefaultTaxProviders } from '../providers/taxProviders'
import { registerTaxProvider } from '../providers/registry'
import { DEFAULT_TAX_PROVIDER_KEY } from '../providers/taxContext'
import type { TaxInfo } from '../providers/taxInfo'
import type {
  TaxDocumentContext,
  TaxProvider,
  TaxProviderCalculateInput,
  TaxProviderCalculateResult,
} from '../providers/types'
import type { SalesAdjustmentDraft, SalesLineSnapshot } from '../types'

ensureProviderTotalsCalculator()
registerDefaultTaxProviders()

const baseContext = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  currencyCode: 'USD',
}

function makeTaxContext(overrides: Partial<TaxDocumentContext> = {}): TaxDocumentContext {
  return {
    document: {
      kind: 'order',
      id: 'order-1',
      number: 'SO-1',
      date: '2026-09-19T00:00:00.000Z',
      channelId: null,
      intent: 'estimate',
    },
    customer: null,
    addresses: { shipFrom: null, shipTo: null, billTo: null },
    productFacts: {},
    selection: {
      providerKey: DEFAULT_TAX_PROVIDER_KEY,
      settings: {},
      integrationId: null,
      integrationEnabled: true,
    },
    resolveCredentials: async () => ({}),
    timeoutMs: 8000,
    totalsMode: 'computed',
    metadata: {},
    ...overrides,
  }
}

const defaultLines: SalesLineSnapshot[] = [
  { id: 'line-1', lineNumber: 1, kind: 'product', quantity: 2, currencyCode: 'USD', unitPriceNet: 10, taxRate: 20 },
  { id: 'line-2', lineNumber: 2, kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 50, taxRate: 10 },
]

async function calculate(params: {
  tax?: TaxDocumentContext | null
  lines?: SalesLineSnapshot[]
  adjustments?: SalesAdjustmentDraft[]
}) {
  return calculateDocumentTotals({
    documentKind: 'order',
    lines: params.lines ?? defaultLines,
    adjustments: params.adjustments ?? [],
    context: {
      ...baseContext,
      metadata: params.tax === undefined || params.tax === null ? {} : { tax: params.tax },
    },
  })
}

function taxInfoOf(metadata: Record<string, unknown>): TaxInfo {
  return metadata.tax as TaxInfo
}

let unregister: Array<() => void> = []

function registerSpyProvider(
  key: string,
  calculate: (input: TaxProviderCalculateInput) => Promise<TaxProviderCalculateResult | null> | TaxProviderCalculateResult | null,
  overrides: Partial<TaxProvider> = {}
) {
  unregister.push(registerTaxProvider({ key, label: key, calculate, ...overrides }))
}

afterEach(() => {
  unregister.forEach((fn) => fn())
  unregister = []
  mockLogger.warn.mockClear()
})

describe('tax stage', () => {
  it('is skipped entirely when the context carries no tax block', async () => {
    const result = await calculate({ tax: null })
    expect(result.metadata.tax).toBeUndefined()
    expect(result.totals.taxTotalAmount).toBeCloseTo(9, 4)
  })

  it('leaves every amount untouched under the default provider', async () => {
    const withoutTax = await calculate({ tax: null })
    const withTax = await calculate({ tax: makeTaxContext() })
    expect(withTax.totals).toEqual(withoutTax.totals)
    expect(withTax.lines.map((line) => line.taxAmount)).toEqual(
      withoutTax.lines.map((line) => line.taxAmount)
    )
    const info = taxInfoOf(withTax.metadata)
    expect(info.providerKey).toBe(DEFAULT_TAX_PROVIDER_KEY)
    expect(info.status).toBe('calculated')
    expect(info.failure).toBeNull()
  })

  it('runs after the shipping stage, so the shipping charge is in the request', async () => {
    let seenCharges: string[] = []
    registerSpyProvider('charge-spy', ({ request }) => {
      seenCharges = request.charges.map((charge) => charge.kind)
      return {
        status: 'calculated',
        lines: request.lines.map((line) => ({
          lineId: line.id,
          taxAmount: 0,
          taxableAmount: line.amountNet,
          exemptAmount: 0,
          rate: 0,
          details: [],
        })),
        totals: { taxTotal: 0, taxableTotal: 0, exemptTotal: 0 },
      }
    })
    await calculate({
      tax: makeTaxContext({
        selection: {
          providerKey: 'charge-spy',
          settings: {},
          integrationId: null,
          integrationEnabled: true,
        },
      }),
      adjustments: [
        { id: 'adj-1', scope: 'order', kind: 'shipping', amountNet: 10, amountGross: 12, currencyCode: 'USD', metadata: { taxRateValue: 20 } },
      ],
    })
    expect(seenCharges).toContain('shipping')
  })

  it('writes the provider amounts onto the lines and rebuilds the totals', async () => {
    registerSpyProvider('flat-seven', ({ request }) => ({
      status: 'calculated',
      lines: request.lines.map((line) => ({
        lineId: line.id,
        taxAmount: 7,
        taxableAmount: line.amountNet,
        exemptAmount: 0,
        rate: 7,
        details: [],
      })),
      totals: { taxTotal: 14, taxableTotal: 70, exemptTotal: 0 },
    }))
    const result = await calculate({
      tax: makeTaxContext({
        selection: { providerKey: 'flat-seven', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    expect(result.lines.map((line) => line.taxAmount)).toEqual([7, 7])
    expect(result.lines[0].grossAmount).toBeCloseTo(27, 4)
    expect(result.totals.taxTotalAmount).toBeCloseTo(14, 4)
    expect(result.totals.grandTotalGrossAmount).toBeCloseTo(84, 4)
  })

  it('falls back to the engine figures when the provider throws', async () => {
    const baseline = await calculate({ tax: null })
    registerSpyProvider('boom', () => {
      throw new Error('vendor exploded')
    })
    const result = await calculate({
      tax: makeTaxContext({
        selection: { providerKey: 'boom', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    expect(result.totals.taxTotalAmount).toBeCloseTo(baseline.totals.taxTotalAmount, 4)
    const info = taxInfoOf(result.metadata)
    expect(info.status).toBe('fallback')
    expect(info.failure?.code).toBe('provider_error')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('falls back within the timeout budget when the provider hangs', async () => {
    const baseline = await calculate({ tax: null })
    registerSpyProvider(
      'sleepy',
      () => new Promise<TaxProviderCalculateResult>(() => {})
    )
    const startedAt = Date.now()
    const result = await calculate({
      tax: makeTaxContext({
        timeoutMs: 1000,
        selection: { providerKey: 'sleepy', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    expect(Date.now() - startedAt).toBeLessThan(1500)
    expect(result.totals.taxTotalAmount).toBeCloseTo(baseline.totals.taxTotalAmount, 4)
    expect(taxInfoOf(result.metadata).failure?.code).toBe('timeout')
  })

  it('falls back with invalid_result when the provider breaks the contract', async () => {
    registerSpyProvider('garbage', () => ({ status: 'calculated' }) as unknown as TaxProviderCalculateResult)
    const result = await calculate({
      tax: makeTaxContext({
        selection: { providerKey: 'garbage', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    expect(taxInfoOf(result.metadata).failure?.code).toBe('invalid_result')
  })

  it('falls back with unsupported when the provider declines, and reports it as info', async () => {
    registerSpyProvider('declines', () => null)
    const result = await calculate({
      tax: makeTaxContext({
        selection: { providerKey: 'declines', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    const info = taxInfoOf(result.metadata)
    expect(info.failure?.code).toBe('unsupported')
    expect(info.messages[0].level).toBe('info')
  })

  it('treats an unsupported status the same as a decline', async () => {
    registerSpyProvider('out-of-scope', ({ request }) => ({
      status: 'unsupported',
      lines: request.lines.map((line) => ({
        lineId: line.id,
        taxAmount: 0,
        taxableAmount: 0,
        exemptAmount: 0,
        rate: null,
        details: [],
      })),
      totals: { taxTotal: 0, taxableTotal: 0, exemptTotal: 0 },
    }))
    const baseline = await calculate({ tax: null })
    const result = await calculate({
      tax: makeTaxContext({
        selection: { providerKey: 'out-of-scope', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    expect(result.totals.taxTotalAmount).toBeCloseTo(baseline.totals.taxTotalAmount, 4)
    expect(taxInfoOf(result.metadata).failure?.code).toBe('unsupported')
  })

  it('falls back to the default provider for an unregistered key', async () => {
    const result = await calculate({
      tax: makeTaxContext({
        selection: { providerKey: 'gone-away', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    const info = taxInfoOf(result.metadata)
    expect(info.failure?.code).toBe('provider_missing')
    expect(info.providerKey).toBe(DEFAULT_TAX_PROVIDER_KEY)
  })

  it('never calls a provider whose integration is disabled', async () => {
    const calls = jest.fn()
    registerSpyProvider(
      'needs-integration',
      () => {
        calls()
        return null
      },
      { integrationId: 'tax_vendor' }
    )
    const result = await calculate({
      tax: makeTaxContext({
        selection: {
          providerKey: 'needs-integration',
          settings: {},
          integrationId: 'tax_vendor',
          integrationEnabled: false,
        },
      }),
    })
    expect(calls).not.toHaveBeenCalled()
    expect(taxInfoOf(result.metadata).failure?.code).toBe('integration_disabled')
  })

  it('resolves credentials only for a provider that declares an integration', async () => {
    const resolveCredentials = jest.fn(async () => ({ apiKey: 'secret' }))
    registerSpyProvider('no-integration', ({ request }) => ({
      status: 'calculated',
      lines: request.lines.map((line) => ({
        lineId: line.id,
        taxAmount: 0,
        taxableAmount: 0,
        exemptAmount: 0,
        rate: 0,
        details: [],
      })),
      totals: { taxTotal: 0, taxableTotal: 0, exemptTotal: 0 },
    }))
    await calculate({
      tax: makeTaxContext({
        resolveCredentials,
        selection: { providerKey: 'no-integration', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    expect(resolveCredentials).not.toHaveBeenCalled()
  })

  it('lands a reconciliation delta on the largest taxable line', async () => {
    registerSpyProvider('drifting', ({ request }) => ({
      status: 'calculated',
      lines: request.lines.map((line) => ({
        lineId: line.id,
        taxAmount: 1,
        taxableAmount: line.amountNet,
        exemptAmount: 0,
        rate: null,
        details: [],
      })),
      totals: { taxTotal: 2.5, taxableTotal: 70, exemptTotal: 0 },
    }))
    const result = await calculate({
      tax: makeTaxContext({
        selection: { providerKey: 'drifting', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    const info = taxInfoOf(result.metadata)
    expect(info.reconciliation).toMatchObject({
      providerTotal: 2.5,
      lineSum: 2,
      delta: 0.5,
      appliedToLineId: 'line-2',
    })
    expect(result.totals.taxTotalAmount).toBeCloseTo(2.5, 4)
  })

  it('records no reconciliation when the provider totals already agree', async () => {
    registerSpyProvider('exact', ({ request }) => ({
      status: 'calculated',
      lines: request.lines.map((line) => ({
        lineId: line.id,
        taxAmount: 1,
        taxableAmount: line.amountNet,
        exemptAmount: 0,
        rate: null,
        details: [],
      })),
      totals: { taxTotal: 2, taxableTotal: 70, exemptTotal: 0 },
    }))
    const result = await calculate({
      tax: makeTaxContext({
        selection: { providerKey: 'exact', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    expect(taxInfoOf(result.metadata).reconciliation).toBeNull()
  })

  it('no-ops with an external status when the document carries external amounts', async () => {
    const calls = jest.fn()
    registerSpyProvider('never-runs', () => {
      calls()
      return null
    })
    const baseline = await calculate({ tax: null })
    const result = await calculate({
      tax: makeTaxContext({
        totalsMode: 'external',
        selection: { providerKey: 'never-runs', settings: {}, integrationId: null, integrationEnabled: true },
      }),
    })
    expect(calls).not.toHaveBeenCalled()
    expect(result.totals.taxTotalAmount).toBeCloseTo(baseline.totals.taxTotalAmount, 4)
    expect(taxInfoOf(result.metadata).status).toBe('external')
  })

  it('records an exempt result with its zeroed amounts', async () => {
    const result = await calculate({
      tax: makeTaxContext({
        customer: {
          id: 'cust-1',
          kind: 'company',
          code: 'cust-1',
          displayName: 'Acme Inc',
          taxId: null,
          taxIdType: null,
          exemption: { isExempt: true, code: 'RESALE', certificateNumber: 'CERT-1' },
        },
        selection: {
          providerKey: 'fixed-rate',
          settings: { rate: 5 },
          integrationId: null,
          integrationEnabled: true,
        },
      }),
    })
    expect(result.totals.taxTotalAmount).toBe(0)
    const info = taxInfoOf(result.metadata)
    expect(info.status).toBe('exempt')
    expect(info.totals.exemptTotal).toBeCloseTo(info.totals.taxableTotal, 4)
  })

  it('applies charge tax to the right adjustment when a line-scoped one precedes it', async () => {
    // Regression: the request enumerated only the ORDER-scoped adjustments
    // while the apply pass walked ALL of them. With a line-scoped adjustment
    // first and an anonymous order-scoped one after it (no id, no
    // calculatorKey), the positional fallback produced two different ids and
    // the provider's tax for that charge was dropped without a trace.
    let requestedChargeIds: string[] = []
    registerSpyProvider('charge-identity', ({ request }) => {
      requestedChargeIds = request.charges.map((charge) => charge.id)
      return {
        status: 'calculated',
        lines: request.lines.map((line) => ({
          lineId: line.id,
          taxAmount: 0,
          taxableAmount: line.amountNet,
          exemptAmount: 0,
          rate: 0,
          details: [],
        })),
        charges: request.charges.map((charge) => ({
          chargeId: charge.id,
          taxAmount: 3,
          taxableAmount: charge.amountNet,
          rate: 30,
          details: [],
        })),
        totals: { taxTotal: 3 * request.charges.length, taxableTotal: 0, exemptTotal: 0 },
      }
    })

    const result = await calculate({
      tax: makeTaxContext({
        selection: {
          providerKey: 'charge-identity',
          settings: {},
          integrationId: null,
          integrationEnabled: true,
        },
      }),
      adjustments: [
        // Line-scoped, so it is absent from the request but present in the
        // adjustment array the apply pass walks.
        { scope: 'line', kind: 'discount', amountNet: 5, amountGross: 5, currencyCode: 'USD' },
        // Anonymous and order-scoped: the only case the positional fallback
        // was ever used for.
        { scope: 'order', kind: 'shipping', amountNet: 10, amountGross: 10, currencyCode: 'USD' },
      ],
    })

    expect(requestedChargeIds).toEqual(['shipping-0'])
    const shipping = result.adjustments.find(
      (adjustment) => adjustment.kind === 'shipping' && (adjustment.scope ?? 'order') === 'order'
    )
    // 10 net + the provider's 3 of tax. Before the fix this stayed at 10.
    expect(Number(shipping?.amountGross)).toBeCloseTo(13, 4)
    expect((shipping?.metadata as Record<string, unknown>)?.taxRate).toBe(30)
  })

  it('emits sales.tax.calculation.failed for every fallback', async () => {
    const emitted: Array<{ id: string; payload: Record<string, unknown> }> = []
    const eventBus = {
      emitEvent: async (id: string, payload: Record<string, unknown>) => {
        emitted.push({ id, payload })
      },
    }
    registerSpyProvider('event-boom', () => {
      throw new Error('vendor exploded')
    })
    await calculateDocumentTotals({
      documentKind: 'order',
      lines: defaultLines,
      adjustments: [],
      context: {
        ...baseContext,
        metadata: {
          tax: makeTaxContext({
            selection: { providerKey: 'event-boom', settings: {}, integrationId: null, integrationEnabled: true },
          }),
        },
      },
      eventBus: eventBus as never,
    })
    const failed = emitted.find((entry) => entry.id === 'sales.tax.calculation.failed')
    expect(failed).toBeDefined()
    expect(failed!.payload).toMatchObject({
      documentKind: 'order',
      documentId: 'order-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      providerKey: 'event-boom',
      code: 'provider_error',
    })
  })

  it('emits no failure event when the calculation succeeds', async () => {
    const emitted: string[] = []
    const eventBus = {
      emitEvent: async (id: string) => {
        emitted.push(id)
      },
    }
    await calculateDocumentTotals({
      documentKind: 'order',
      lines: defaultLines,
      adjustments: [],
      context: { ...baseContext, metadata: { tax: makeTaxContext() } },
      eventBus: eventBus as never,
    })
    expect(emitted).not.toContain('sales.tax.calculation.failed')
  })

  it('keeps the persisted document free of addresses and customer identity', async () => {
    const result = await calculate({
      tax: makeTaxContext({
        addresses: {
          shipFrom: null,
          shipTo: {
            line1: '742 Evergreen Terrace',
            line2: null,
            buildingNumber: null,
            flatNumber: null,
            city: 'Springfield',
            region: 'OR',
            postalCode: '97477',
            country: 'US',
            latitude: null,
            longitude: null,
          },
          billTo: null,
        },
        customer: {
          id: 'cust-1',
          kind: 'person',
          code: 'cust-1',
          displayName: 'Homer Simpson',
          taxId: 'US-999',
          taxIdType: 'ssn',
          exemption: null,
        },
      }),
    })
    const serialized = JSON.stringify(taxInfoOf(result.metadata))
    expect(serialized).not.toContain('Evergreen')
    expect(serialized).not.toContain('Homer')
    expect(serialized).not.toContain('US-999')
  })
})
