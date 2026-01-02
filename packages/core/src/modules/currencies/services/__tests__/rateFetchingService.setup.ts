import type { EntityManager } from '@mikro-orm/core'
import { Currency, ExchangeRate } from '../../data/entities'
import type { RateProvider, RateProviderResult } from '../providers/base'

export interface MockEntityManagerConfig {
  currencies?: Currency[]
  existingRates?: ExchangeRate[]
  shouldFailTransaction?: boolean
}

export interface MockProviderConfig {
  source: string
  name?: string
  isAvailable?: boolean
  rates?: RateProviderResult[]
  error?: Error
}

/**
 * Create a mock EntityManager for testing
 */
export function createMockEntityManager(config: MockEntityManagerConfig = {}) {
  const persisted: any[] = []
  const flushed: boolean[] = []
  
  const mockEm: any = {
    find: jest.fn(async (entityClass: any, filter: any) => {
      // Return currencies for Currency entity queries
      if (entityClass === Currency || entityClass.name === 'Currency') {
        const currencies = config.currencies || []
        // Apply filters if specified
        return currencies.filter(c => {
          if (filter.isActive !== undefined && c.isActive !== filter.isActive) return false
          if (filter.deletedAt !== undefined && filter.deletedAt === null && c.deletedAt !== null) return false
          if (filter.tenantId && c.tenantId !== filter.tenantId) return false
          if (filter.organizationId && c.organizationId !== filter.organizationId) return false
          return true
        })
      }
      return []
    }),
    
    findOne: jest.fn(async (entityClass: any, filter: any) => {
      // Return existing rate if it matches all unique constraint fields
      if ((entityClass === ExchangeRate || entityClass.name === 'ExchangeRate') && config.existingRates) {
        return config.existingRates.find(r =>
          r.organizationId === filter.organizationId &&
          r.tenantId === filter.tenantId &&
          r.fromCurrencyCode === filter.fromCurrencyCode &&
          r.toCurrencyCode === filter.toCurrencyCode &&
          r.date.getTime() === filter.date.getTime() &&
          r.source === filter.source
        ) || null
      }
      return null
    }),
    
    create: jest.fn((entityClass: any, data: any) => ({
      ...data,
      id: `mock-id-${Math.random()}`,
    })),
    
    persist: jest.fn((entity: any) => {
      persisted.push(entity)
    }),
    
    flush: jest.fn(async () => {
      flushed.push(true)
    }),
    
    transactional: jest.fn(async (callback: (em: any) => Promise<any>) => {
      if (config.shouldFailTransaction) {
        throw new Error('Transaction failed')
      }
      // Create a separate mock EM for the transaction with same config
      const txEm = createMockEntityManager(config).em
      return callback(txEm)
    }),
  }
  
  return {
    em: mockEm,
    persisted,
    flushed,
  }
}

/**
 * Create a mock RateProvider for testing
 */
export function createMockProvider(config: MockProviderConfig): RateProvider {
  return {
    source: config.source,
    name: config.name || config.source,
    isAvailable: jest.fn(() => config.isAvailable ?? true),
    fetchRates: jest.fn(async (date, scope, currencies) => {
      if (config.error) {
        throw config.error
      }
      return config.rates || []
    }),
  }
}

/**
 * Create a test Currency entity
 */
export function createTestCurrency(overrides?: Partial<Currency>): Currency {
  return {
    id: overrides?.id || `currency-${Math.random()}`,
    organizationId: 'test-org',
    tenantId: 'test-tenant',
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    decimalPlaces: 2,
    thousandsSeparator: ',',
    decimalSeparator: '.',
    isBase: false,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    deletedAt: null,
    ...overrides,
  } as Currency
}

/**
 * Create a test RateProviderResult
 */
export function createTestRate(overrides?: Partial<RateProviderResult>): RateProviderResult {
  return {
    fromCurrencyCode: 'USD',
    toCurrencyCode: 'EUR',
    rate: '0.85',
    source: 'TEST',
    date: new Date('2024-01-15T00:00:00.000Z'),
    ...overrides,
  }
}

/**
 * Create a test ExchangeRate entity
 */
export function createTestExchangeRate(overrides?: Partial<ExchangeRate>): ExchangeRate {
  return {
    id: `rate-${Math.random()}`,
    organizationId: 'test-org',
    tenantId: 'test-tenant',
    fromCurrencyCode: 'USD',
    toCurrencyCode: 'EUR',
    rate: '0.85',
    date: new Date('2024-01-15T00:00:00.000Z'),
    source: 'TEST',
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    deletedAt: null,
    ...overrides,
  } as ExchangeRate
}

/**
 * Common test constants
 */
export const TEST_SCOPE = {
  tenantId: 'test-tenant',
  organizationId: 'test-org',
}

export const TEST_DATE = new Date('2024-01-15T00:00:00.000Z')
