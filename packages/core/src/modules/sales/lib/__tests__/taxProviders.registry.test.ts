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

import { z } from 'zod'
import {
  getTaxProvider,
  listTaxProviders,
  normalizeProviderSettings,
  registerTaxProvider,
} from '../providers/registry'
import type { TaxProvider, TaxProviderCalculateResult } from '../providers/types'

const emptyResult: TaxProviderCalculateResult = {
  status: 'calculated',
  lines: [],
  totals: { taxTotal: 0, taxableTotal: 0, exemptTotal: 0 },
}

function makeProvider(overrides: Partial<TaxProvider> = {}): TaxProvider {
  return {
    key: 'test-tax',
    label: 'Test tax',
    calculate: async () => emptyResult,
    ...overrides,
  }
}

describe('tax provider registry', () => {
  const unregisterHandles: Array<() => void> = []

  afterEach(() => {
    while (unregisterHandles.length) unregisterHandles.pop()?.()
    mockLogger.warn.mockClear()
  })

  function register(provider: TaxProvider) {
    const unregister = registerTaxProvider(provider)
    unregisterHandles.push(unregister)
    return unregister
  }

  it('registers a provider and looks it up by key', () => {
    register(makeProvider())
    expect(getTaxProvider('test-tax')?.label).toBe('Test tax')
    expect(listTaxProviders().map((provider) => provider.key)).toContain('test-tax')
  })

  it('trims the key so a padded registration is still addressable', () => {
    register(makeProvider({ key: '  padded-tax  ' }))
    expect(getTaxProvider('padded-tax')?.key).toBe('padded-tax')
  })

  it('ignores a provider without a usable key', () => {
    register(makeProvider({ key: '   ' }))
    expect(listTaxProviders().some((provider) => provider.label === 'Test tax' && !provider.key)).toBe(false)
  })

  it('overwrites an existing registration with the same key', () => {
    register(makeProvider())
    register(makeProvider({ label: 'Replaced' }))
    expect(getTaxProvider('test-tax')?.label).toBe('Replaced')
    expect(listTaxProviders().filter((provider) => provider.key === 'test-tax')).toHaveLength(1)
  })

  it('unregisters through the returned handle', () => {
    const unregister = registerTaxProvider(makeProvider())
    unregister()
    expect(getTaxProvider('test-tax')).toBeNull()
  })

  it('returns null for an unknown or empty key', () => {
    expect(getTaxProvider('nobody')).toBeNull()
    expect(getTaxProvider(null)).toBeNull()
    expect(getTaxProvider(undefined)).toBeNull()
  })

  it('drops secret settings fields and warns, because secrets belong to the integrations module', () => {
    register(
      makeProvider({
        settings: {
          fields: [
            { key: 'taxCode', label: 'Default tax code', type: 'text' },
            { key: 'licenseKey', label: 'License key', type: 'secret' },
          ],
        },
      })
    )
    expect(getTaxProvider('test-tax')?.settings?.fields?.map((field) => field.key)).toEqual(['taxCode'])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'tax provider settings must not declare secret fields',
      expect.objectContaining({ key: 'test-tax', field: 'licenseKey' })
    )
  })

  it("normalizes settings through the 'tax' kind using the provider schema", () => {
    register(
      makeProvider({
        settings: {
          schema: z.object({ rate: z.coerce.number().default(0) }),
        },
      })
    )
    expect(normalizeProviderSettings('tax', 'test-tax', { rate: '7.5' })).toEqual({ rate: 7.5 })
  })

  it('returns the raw settings when the provider schema rejects them', () => {
    register(
      makeProvider({
        settings: { schema: z.object({ rate: z.number() }) },
      })
    )
    expect(normalizeProviderSettings('tax', 'test-tax', { rate: 'nope' })).toEqual({ rate: 'nope' })
  })
})
