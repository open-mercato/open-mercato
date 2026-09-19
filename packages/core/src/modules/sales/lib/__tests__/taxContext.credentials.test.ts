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
  error: jest.Mock
  info: jest.Mock
  debug: jest.Mock
}

import { calculateDocumentTotals } from '../calculations'
import { ensureProviderTotalsCalculator } from '../providers/totals'
import { registerTaxProvider } from '../providers/registry'
import { registerDefaultTaxProviders } from '../providers/taxProviders'
import { resolveTaxDocumentContext } from '../providers/taxContext'
import type { TaxInfo } from '../providers/taxInfo'
import type { TaxProviderCalculateInput } from '../providers/types'
import { SalesSettings } from '../../data/entities'

ensureProviderTotalsCalculator()
registerDefaultTaxProviders()

const SECRET = 'lk_super_secret_license_key'
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function makeEm(settings: Partial<SalesSettings> | null) {
  return {
    async findOne(entity: unknown, _where: unknown) {
      if (entity === SalesSettings) return settings
      return null
    },
    async find() {
      return []
    },
  } as never as Parameters<typeof resolveTaxDocumentContext>[0]['em']
}

function makeContainer(overrides: Record<string, unknown> = {}) {
  const registry: Record<string, unknown> = {
    integrationStateService: { isEnabled: async () => true },
    integrationCredentialsService: { resolve: async () => ({ licenseKey: SECRET }) },
    ...overrides,
  }
  return {
    resolve: (key: string) => {
      if (!(key in registry)) throw new Error(`not registered: ${key}`)
      return registry[key]
    },
  }
}

let unregister: Array<() => void> = []

afterEach(() => {
  unregister.forEach((fn) => fn())
  unregister = []
  mockLogger.warn.mockClear()
  mockLogger.error.mockClear()
  mockLogger.info.mockClear()
  mockLogger.debug.mockClear()
})

describe('tax provider credential hygiene', () => {
  it('resolves credentials only when the provider actually calculates', async () => {
    const resolve = jest.fn(async () => ({ licenseKey: SECRET }))
    let seen: Record<string, unknown> | null = null
    unregister.push(
      registerTaxProvider({
        key: 'vendor',
        label: 'Vendor',
        integrationId: 'tax_vendor',
        calculate: ({ credentials, request }: TaxProviderCalculateInput) => {
          seen = credentials
          return {
            status: 'calculated' as const,
            lines: request.lines.map((line) => ({
              lineId: line.id,
              taxAmount: 0,
              taxableAmount: 0,
              exemptAmount: 0,
              rate: 0,
              details: [],
            })),
            totals: { taxTotal: 0, taxableTotal: 0, exemptTotal: 0 },
          }
        },
      })
    )

    const container = makeContainer({ integrationCredentialsService: { resolve } })
    const tax = await resolveTaxDocumentContext({
      em: makeEm({ taxProviderKey: 'vendor' } as Partial<SalesSettings>),
      container,
      ...scope,
      documentKind: 'order',
    })

    // Building the context must not have fetched anything.
    expect(resolve).not.toHaveBeenCalled()

    await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ id: 'line-1', kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 100 }],
      adjustments: [],
      context: { ...scope, currencyCode: 'USD', metadata: { tax } },
    })

    expect(resolve).toHaveBeenCalledTimes(1)
    expect(seen).toEqual({ licenseKey: SECRET })
  })

  it('never fetches credentials for a provider that declares no integration', async () => {
    const resolve = jest.fn(async () => ({ licenseKey: SECRET }))
    const tax = await resolveTaxDocumentContext({
      em: makeEm({ taxProviderKey: 'fixed-rate' } as Partial<SalesSettings>),
      container: makeContainer({ integrationCredentialsService: { resolve } }),
      ...scope,
      documentKind: 'order',
    })
    await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ id: 'line-1', kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 100 }],
      adjustments: [],
      context: { ...scope, currencyCode: 'USD', metadata: { tax } },
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('keeps the secret out of a serialized calculation context', async () => {
    const tax = await resolveTaxDocumentContext({
      em: makeEm({ taxProviderKey: 'fixed-rate' } as Partial<SalesSettings>),
      container: makeContainer(),
      ...scope,
      documentKind: 'order',
    })
    // This is the shape the sales.document.calculate.before payload carries.
    const serialized = JSON.stringify({ metadata: { tax } })
    expect(serialized).not.toContain(SECRET)
    expect(serialized).not.toContain('resolveCredentials')
  })

  it('keeps the secret out of the persisted tax document', async () => {
    unregister.push(
      registerTaxProvider({
        key: 'leaky-by-accident',
        label: 'Leaky',
        integrationId: 'tax_vendor',
        calculate: ({ request }: TaxProviderCalculateInput) => ({
          status: 'calculated' as const,
          lines: request.lines.map((line) => ({
            lineId: line.id,
            taxAmount: 1,
            taxableAmount: line.amountNet,
            exemptAmount: 0,
            rate: 1,
            details: [],
          })),
          totals: { taxTotal: 1, taxableTotal: 100, exemptTotal: 0 },
        }),
      })
    )
    const tax = await resolveTaxDocumentContext({
      em: makeEm({ taxProviderKey: 'leaky-by-accident' } as Partial<SalesSettings>),
      container: makeContainer(),
      ...scope,
      documentKind: 'order',
    })
    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ id: 'line-1', kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 100 }],
      adjustments: [],
      context: { ...scope, currencyCode: 'USD', metadata: { tax } },
    })
    const info = result.metadata.tax as TaxInfo
    expect(JSON.stringify(info)).not.toContain(SECRET)
  })

  it('never writes a secret to the logger, even when the provider fails', async () => {
    unregister.push(
      registerTaxProvider({
        key: 'exploding-vendor',
        label: 'Exploding vendor',
        integrationId: 'tax_vendor',
        calculate: () => {
          throw new Error('vendor exploded')
        },
      })
    )
    const tax = await resolveTaxDocumentContext({
      em: makeEm({ taxProviderKey: 'exploding-vendor' } as Partial<SalesSettings>),
      container: makeContainer(),
      ...scope,
      documentKind: 'order',
    })
    await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ id: 'line-1', kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 100 }],
      adjustments: [],
      context: { ...scope, currencyCode: 'USD', metadata: { tax } },
    })
    expect(mockLogger.warn).toHaveBeenCalled()
    const everyLoggedArgument = JSON.stringify(
      [mockLogger.warn, mockLogger.error, mockLogger.info, mockLogger.debug].flatMap((fn) => fn.mock.calls)
    )
    expect(everyLoggedArgument).not.toContain(SECRET)
  })

  it('treats a provider as disabled when its integration is off, without calling it', async () => {
    const calculate = jest.fn(() => null)
    unregister.push(
      registerTaxProvider({
        key: 'disabled-vendor',
        label: 'Disabled vendor',
        integrationId: 'tax_vendor',
        calculate,
      })
    )
    const tax = await resolveTaxDocumentContext({
      em: makeEm({ taxProviderKey: 'disabled-vendor' } as Partial<SalesSettings>),
      container: makeContainer({ integrationStateService: { isEnabled: async () => false } }),
      ...scope,
      documentKind: 'order',
    })
    expect(tax.selection.integrationEnabled).toBe(false)

    const result = await calculateDocumentTotals({
      documentKind: 'order',
      lines: [{ id: 'line-1', kind: 'product', quantity: 1, currencyCode: 'USD', unitPriceNet: 100 }],
      adjustments: [],
      context: { ...scope, currencyCode: 'USD', metadata: { tax } },
    })
    expect(calculate).not.toHaveBeenCalled()
    expect((result.metadata.tax as TaxInfo).failure?.code).toBe('integration_disabled')
  })

  it('treats a provider as unavailable when the integrations module is absent', async () => {
    unregister.push(
      registerTaxProvider({
        key: 'needs-integrations',
        label: 'Needs integrations',
        integrationId: 'tax_vendor',
        calculate: () => null,
      })
    )
    const tax = await resolveTaxDocumentContext({
      em: makeEm({ taxProviderKey: 'needs-integrations' } as Partial<SalesSettings>),
      // A container that registers neither integrations service.
      container: { resolve: () => { throw new Error('not registered') } },
      ...scope,
      documentKind: 'order',
    })
    expect(tax.selection.integrationEnabled).toBe(false)
    expect(await tax.resolveCredentials()).toEqual({})
  })

  it('returns no credentials rather than throwing when the vendor lookup fails', async () => {
    unregister.push(
      registerTaxProvider({
        key: 'credential-failure',
        label: 'Credential failure',
        integrationId: 'tax_vendor',
        calculate: () => null,
      })
    )
    const tax = await resolveTaxDocumentContext({
      em: makeEm({ taxProviderKey: 'credential-failure' } as Partial<SalesSettings>),
      container: makeContainer({
        integrationCredentialsService: {
          resolve: async () => {
            throw new Error(`credential store unavailable ${SECRET}`)
          },
        },
      }),
      ...scope,
      documentKind: 'order',
    })
    await expect(tax.resolveCredentials()).resolves.toEqual({})
  })
})

describe('the organization selection drives the context', () => {
  it('uses the built in default when the organization has no settings row', async () => {
    const tax = await resolveTaxDocumentContext({
      em: makeEm(null),
      container: makeContainer(),
      ...scope,
      documentKind: 'order',
    })
    expect(tax.selection.providerKey).toBe('table-rates')
    expect(tax.selection.integrationId).toBeNull()
    expect(tax.timeoutMs).toBe(8000)
  })

  it('carries the organization settings, timeout and ship from address', async () => {
    const tax = await resolveTaxDocumentContext({
      em: makeEm({
        taxProviderKey: 'fixed-rate',
        taxProviderSettings: { rate: 5 },
        taxProviderTimeoutMs: 2500,
        shipFromAddress: { addressLine1: 'One Market St', city: 'San Francisco', country: 'US' },
      } as Partial<SalesSettings>),
      container: makeContainer(),
      ...scope,
      documentKind: 'order',
    })
    expect(tax.selection.providerKey).toBe('fixed-rate')
    expect(tax.selection.settings).toEqual({ rate: 5 })
    expect(tax.timeoutMs).toBe(2500)
    expect(tax.addresses.shipFrom?.city).toBe('San Francisco')
  })

  it('clamps a stored timeout that is out of bounds', async () => {
    const tax = await resolveTaxDocumentContext({
      em: makeEm({ taxProviderKey: 'fixed-rate', taxProviderTimeoutMs: 999999 } as Partial<SalesSettings>),
      container: makeContainer(),
      ...scope,
      documentKind: 'order',
    })
    expect(tax.timeoutMs).toBe(30000)
  })
})
