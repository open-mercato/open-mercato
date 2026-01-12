import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { RateFetchingService } from '../rateFetchingService'
import {
  createMockEntityManager,
  createMockProvider,
  createTestCurrency,
  createTestRate,
  TEST_SCOPE,
  TEST_DATE,
} from './rateFetchingService.setup'

describe('RateFetchingService - Error Handling', () => {
  let service: RateFetchingService
  
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('provider errors', () => {
    it('catches provider fetch errors and continues with other providers', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const failingProvider = createMockProvider({
        source: 'FAILING',
        error: new Error('Network timeout'),
      })
      
      const successProvider = createMockProvider({
        source: 'SUCCESS',
        rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' })],
      })
      
      service.registerProvider(failingProvider)
      service.registerProvider(successProvider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.totalFetched).toBe(1) // Only from success provider
      expect(result.byProvider['SUCCESS']).toEqual({ count: 1 })
      expect(result.errors).toContain('FAILING: Network timeout')
      expect(successProvider.fetchRates).toHaveBeenCalled()
    })

    it('records provider-specific errors in byProvider', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'ERROR_SOURCE',
        error: new Error('API rate limit exceeded'),
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.byProvider['ERROR_SOURCE']).toEqual({
        count: 0,
        errors: ['API rate limit exceeded'],
      })
      expect(result.errors).toContain('ERROR_SOURCE: API rate limit exceeded')
    })

    it('sets count to 0 for providers that fail', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'FAILED',
        error: new Error('Connection refused'),
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.byProvider['FAILED'].count).toBe(0)
      expect(result.totalFetched).toBe(0)
    })

    it('includes both provider errors and general errors in result', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const failingProvider = createMockProvider({
        source: 'FAILING',
        error: new Error('Provider error'),
      })
      
      service.registerProvider(failingProvider)
      
      // Execute - also request an unknown provider
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE, {
        providers: ['UNKNOWN', 'FAILING'],
      })
      
      // Assert
      expect(result.errors).toContain('Unknown provider: UNKNOWN')
      expect(result.errors).toContain('FAILING: Provider error')
      expect(result.errors.length).toBe(2)
    })
  })

  describe('edge cases', () => {
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
      // Provider should still be called, just with empty currency set
      expect(provider.fetchRates).toHaveBeenCalledWith(TEST_DATE, TEST_SCOPE, new Set([]))
    })

    it('handles providers returning empty arrays', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'EMPTY',
        rates: [], // Returns no rates
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.totalFetched).toBe(0)
      expect(result.byProvider['EMPTY']).toEqual({ count: 0 })
      expect(result.errors).toEqual([])
    })

    it('handles date objects correctly', async () => {
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
      
      const testDate = new Date('2024-03-15T14:30:00.000Z')
      
      // Execute
      await service.fetchRatesForDate(testDate, TEST_SCOPE)
      
      // Assert
      expect(provider.fetchRates).toHaveBeenCalledWith(testDate, TEST_SCOPE, expect.any(Set))
    })

    it('stores rates with correct scope information', async () => {
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
      
      const customScope = { tenantId: 'tenant-abc', organizationId: 'org-xyz' }
      
      // Execute
      await service.fetchRatesForDate(TEST_DATE, customScope)
      
      // Assert - verify transactional was called (rates stored with scope)
      expect(em.transactional).toHaveBeenCalled()
    })

    it('handles multiple rates from same provider correctly', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
        createTestCurrency({ code: 'GBP' }),
        createTestCurrency({ code: 'CHF' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      // Provider returns many rates
      const rates = [
        createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' }),
        createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'GBP' }),
        createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'CHF' }),
        createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }),
        createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'GBP' }),
        createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'CHF' }),
        createTestRate({ fromCurrencyCode: 'GBP', toCurrencyCode: 'USD' }),
        createTestRate({ fromCurrencyCode: 'GBP', toCurrencyCode: 'EUR' }),
        createTestRate({ fromCurrencyCode: 'CHF', toCurrencyCode: 'USD' }),
        createTestRate({ fromCurrencyCode: 'CHF', toCurrencyCode: 'EUR' }),
      ]
      
      const provider = createMockProvider({
        source: 'MULTI',
        rates,
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.totalFetched).toBe(10)
      expect(result.byProvider['MULTI']).toEqual({ count: 10 })
    })
  })

  describe('database errors', () => {
    it('catches transaction errors and includes them in result', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({
        currencies,
        shouldFailTransaction: true,
      })
      
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'TEST',
        rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' })],
      })
      
      service.registerProvider(provider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert - transaction error should be caught and included in errors
      expect(result.totalFetched).toBe(0)
      expect(result.errors).toContain('TEST: Transaction failed')
      expect(result.byProvider['TEST']).toEqual({
        count: 0,
        errors: ['Transaction failed'],
      })
    })
  })
})
