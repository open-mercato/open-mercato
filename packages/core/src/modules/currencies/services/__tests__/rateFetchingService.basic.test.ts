import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { RateFetchingService } from '../rateFetchingService'
import {
  createMockEntityManager,
  createMockProvider,
  createTestCurrency,
  createTestRate,
  createTestExchangeRate,
  TEST_SCOPE,
  TEST_DATE,
} from './rateFetchingService.setup'

describe('RateFetchingService - Basic Functionality', () => {
  let service: RateFetchingService
  
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('successful fetch operations', () => {
    it('fetches rates from all providers and returns aggregated results', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'PLN', name: 'Polish Zloty' }),
        createTestCurrency({ code: 'EUR', name: 'Euro' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider1 = createMockProvider({
        source: 'PROVIDER1',
        rates: [createTestRate({ fromCurrencyCode: 'PLN', toCurrencyCode: 'EUR', source: 'PROVIDER1' })],
      })
      
      const provider2 = createMockProvider({
        source: 'PROVIDER2',
        rates: [createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'PLN', source: 'PROVIDER2' })],
      })
      
      service.registerProvider(provider1)
      service.registerProvider(provider2)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.totalFetched).toBe(2)
      expect(result.byProvider['PROVIDER1']).toEqual({ count: 1 })
      expect(result.byProvider['PROVIDER2']).toEqual({ count: 1 })
      expect(result.errors).toEqual([])
      expect(provider1.fetchRates).toHaveBeenCalledWith(TEST_DATE, TEST_SCOPE, new Set(['PLN', 'EUR']))
      expect(provider2.fetchRates).toHaveBeenCalledWith(TEST_DATE, TEST_SCOPE, new Set(['PLN', 'EUR']))
    })

    it('stores fetched rates in database using transactions', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'TEST',
        rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' })],
      })
      
      service.registerProvider(provider)
      
      // Execute
      await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(em.transactional).toHaveBeenCalled()
    })

    it('creates new exchange rates when they do not exist', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const testRate = createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR', rate: '0.92' })
      const provider = createMockProvider({
        source: 'TEST',
        rates: [testRate],
      })
      
      service.registerProvider(provider)
      
      // Execute
      await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert - create should be called within the transaction
      expect(em.transactional).toHaveBeenCalled()
    })

    it('updates existing exchange rates when found', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const existingRate = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.85',
        date: TEST_DATE,
        source: 'TEST',
      })
      
      const { em } = createMockEntityManager({ currencies, existingRates: [existingRate] })
      service = new RateFetchingService(em)
      
      const updatedRate = createTestRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.92',
        date: TEST_DATE,
        source: 'TEST',
      })
      
      const provider = createMockProvider({
        source: 'TEST',
        rates: [updatedRate],
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.totalFetched).toBe(1)
      expect(em.transactional).toHaveBeenCalled()
    })

    it('passes correct scope to provider fetchRates', async () => {
      // Setup
      const customScope = { tenantId: 'custom-tenant', organizationId: 'custom-org' }
      const currencies = [
        createTestCurrency({ 
          code: 'USD',
          tenantId: customScope.tenantId,
          organizationId: customScope.organizationId,
        }),
      ]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'TEST',
        rates: [],
      })
      
      service.registerProvider(provider)
      
      // Execute
      await service.fetchRatesForDate(TEST_DATE, customScope)
      
      // Assert
      expect(provider.fetchRates).toHaveBeenCalledWith(TEST_DATE, customScope, new Set(['USD']))
    })
  })

  describe('currency filtering (critical)', () => {
    it('only stores rates where both currencies exist and are active', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'PLN' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'TEST',
        rates: [
          createTestRate({ fromCurrencyCode: 'PLN', toCurrencyCode: 'EUR' }), // Valid
          createTestRate({ fromCurrencyCode: 'PLN', toCurrencyCode: 'USD' }), // USD not in DB
          createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'GBP' }), // GBP not in DB
        ],
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert - only 1 rate should be stored (PLN→EUR)
      expect(result.totalFetched).toBe(1)
    })

    it('filters out rates involving inactive currencies', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD', isActive: true }),
        createTestCurrency({ code: 'EUR', isActive: false }), // Inactive
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'TEST',
        rates: [
          createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' }),
        ],
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert - EUR is inactive, so currency set should only contain USD
      // The rate USD→EUR should be filtered out
      expect(result.totalFetched).toBe(0)
    })

    it('filters out rates involving soft-deleted currencies', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD', deletedAt: null }),
        createTestCurrency({ code: 'EUR', deletedAt: new Date() }), // Soft-deleted
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'TEST',
        rates: [
          createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' }),
        ],
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert - EUR is soft-deleted, so should be filtered
      expect(result.totalFetched).toBe(0)
    })

    it('queries currencies with correct tenant and organization scope', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({ source: 'TEST', rates: [] })
      service.registerProvider(provider)
      
      const customScope = { tenantId: 'tenant-123', organizationId: 'org-456' }
      
      // Execute
      await service.fetchRatesForDate(TEST_DATE, customScope)
      
      // Assert
      expect(em.find).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: 'tenant-123',
          organizationId: 'org-456',
          isActive: true,
          deletedAt: null,
        })
      )
    })

    it('handles empty currency list gracefully', async () => {
      // Setup - no currencies in database
      const { em } = createMockEntityManager({ currencies: [] })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'TEST',
        rates: [createTestRate()],
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.totalFetched).toBe(0)
      expect(result.errors).toEqual([])
      expect(provider.fetchRates).toHaveBeenCalledWith(TEST_DATE, TEST_SCOPE, new Set([]))
    })
  })

  describe('result structure', () => {
    it('returns correct totalFetched count', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
        createTestCurrency({ code: 'GBP' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider1 = createMockProvider({
        source: 'PROVIDER1',
        rates: [
          createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' }),
          createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'GBP' }),
        ],
      })
      
      const provider2 = createMockProvider({
        source: 'PROVIDER2',
        rates: [
          createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }),
          createTestRate({ fromCurrencyCode: 'GBP', toCurrencyCode: 'USD' }),
        ],
      })
      
      service.registerProvider(provider1)
      service.registerProvider(provider2)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.totalFetched).toBe(4)
    })

    it('returns per-provider counts in byProvider', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider1 = createMockProvider({
        source: 'SOURCE1',
        rates: [
          createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' }),
          createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }),
        ],
      })
      
      const provider2 = createMockProvider({
        source: 'SOURCE2',
        rates: [
          createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' }),
        ],
      })
      
      service.registerProvider(provider1)
      service.registerProvider(provider2)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.byProvider['SOURCE1']).toEqual({ count: 2 })
      expect(result.byProvider['SOURCE2']).toEqual({ count: 1 })
    })

    it('returns empty errors array when all succeed', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'TEST',
        rates: [],
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.errors).toEqual([])
    })
  })
})
