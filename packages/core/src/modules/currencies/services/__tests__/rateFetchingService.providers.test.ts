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

describe('RateFetchingService - Provider Management', () => {
  let service: RateFetchingService
  
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('provider selection', () => {
    it('uses all registered providers by default', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider1 = createMockProvider({
        source: 'PROVIDER1',
        rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' })],
      })
      
      const provider2 = createMockProvider({
        source: 'PROVIDER2',
        rates: [createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' })],
      })
      
      service.registerProvider(provider1)
      service.registerProvider(provider2)
      
      // Execute - no providers specified in options
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert - both providers should be called
      expect(provider1.fetchRates).toHaveBeenCalled()
      expect(provider2.fetchRates).toHaveBeenCalled()
      expect(result.totalFetched).toBe(2)
    })

    it('uses only specified providers when options.providers is set', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider1 = createMockProvider({
        source: 'PROVIDER1',
        rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' })],
      })
      
      const provider2 = createMockProvider({
        source: 'PROVIDER2',
        rates: [createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' })],
      })
      
      service.registerProvider(provider1)
      service.registerProvider(provider2)
      
      // Execute - only request PROVIDER1
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE, {
        providers: ['PROVIDER1'],
      })
      
      // Assert - only PROVIDER1 should be called
      expect(provider1.fetchRates).toHaveBeenCalled()
      expect(provider2.fetchRates).not.toHaveBeenCalled()
      expect(result.totalFetched).toBe(1)
      expect(result.byProvider['PROVIDER1']).toBeDefined()
      expect(result.byProvider['PROVIDER2']).toBeUndefined()
    })

    it('handles unknown provider names gracefully', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider = createMockProvider({
        source: 'KNOWN',
        rates: [],
      })
      
      service.registerProvider(provider)
      
      // Execute - request an unknown provider
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE, {
        providers: ['UNKNOWN'],
      })
      
      // Assert
      expect(result.errors).toContain('Unknown provider: UNKNOWN')
      expect(result.totalFetched).toBe(0)
      expect(provider.fetchRates).not.toHaveBeenCalled()
    })

    it('processes valid providers even with unknown ones in list', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const knownProvider = createMockProvider({
        source: 'KNOWN',
        rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' })],
      })
      
      service.registerProvider(knownProvider)
      
      // Execute - mix of unknown and known providers
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE, {
        providers: ['UNKNOWN1', 'KNOWN', 'UNKNOWN2'],
      })
      
      // Assert
      expect(result.errors).toContain('Unknown provider: UNKNOWN1')
      expect(result.errors).toContain('Unknown provider: UNKNOWN2')
      expect(result.totalFetched).toBe(1) // From KNOWN provider
      expect(knownProvider.fetchRates).toHaveBeenCalled()
      expect(result.byProvider['KNOWN']).toEqual({ count: 1 })
    })
  })

  describe('provider availability', () => {
    it('skips providers that report isAvailable() === false', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const unavailableProvider = createMockProvider({
        source: 'UNAVAILABLE',
        isAvailable: false,
        rates: [createTestRate()],
      })
      
      service.registerProvider(unavailableProvider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(unavailableProvider.isAvailable).toHaveBeenCalled()
      expect(unavailableProvider.fetchRates).not.toHaveBeenCalled()
      expect(result.totalFetched).toBe(0)
    })

    it('adds error for unavailable providers', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const unavailableProvider = createMockProvider({
        source: 'OFFLINE',
        isAvailable: false,
        rates: [],
      })
      
      service.registerProvider(unavailableProvider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(result.errors).toContain('Provider not available: OFFLINE')
    })

    it('processes available providers when some are unavailable', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const unavailableProvider = createMockProvider({
        source: 'UNAVAILABLE',
        isAvailable: false,
        rates: [],
      })
      
      const availableProvider = createMockProvider({
        source: 'AVAILABLE',
        isAvailable: true,
        rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' })],
      })
      
      service.registerProvider(unavailableProvider)
      service.registerProvider(availableProvider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(unavailableProvider.fetchRates).not.toHaveBeenCalled()
      expect(availableProvider.fetchRates).toHaveBeenCalled()
      expect(result.totalFetched).toBe(1)
      expect(result.errors).toContain('Provider not available: UNAVAILABLE')
    })

    it('calls isAvailable() for each provider before fetching', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider1 = createMockProvider({
        source: 'PROVIDER1',
        isAvailable: true,
        rates: [],
      })
      
      const provider2 = createMockProvider({
        source: 'PROVIDER2',
        isAvailable: true,
        rates: [],
      })
      
      service.registerProvider(provider1)
      service.registerProvider(provider2)
      
      // Execute
      await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert
      expect(provider1.isAvailable).toHaveBeenCalled()
      expect(provider2.isAvailable).toHaveBeenCalled()
    })
  })

  describe('registerProvider', () => {
    it('registers providers for fetching rates', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      // Service starts with no providers
      // Register custom test providers
      const customProvider = createMockProvider({
        source: 'CUSTOM',
        rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' })],
      })
      
      service.registerProvider(customProvider)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert - custom provider should be used
      expect(customProvider.fetchRates).toHaveBeenCalled()
      expect(result.byProvider['CUSTOM']).toBeDefined()
      expect(Object.keys(result.byProvider)).toEqual(['CUSTOM'])
    })

    it('allows registering multiple providers', async () => {
      // Setup
      const currencies = [createTestCurrency({ code: 'USD' })]
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const firstProvider = createMockProvider({
        source: 'FIRST',
        rates: [],
      })
      
      const secondProvider = createMockProvider({
        source: 'SECOND',
        rates: [],
      })
      
      // Register both providers
      service.registerProvider(firstProvider)
      service.registerProvider(secondProvider)
      
      // Execute
      await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert - both providers should be called
      expect(firstProvider.fetchRates).toHaveBeenCalled()
      expect(secondProvider.fetchRates).toHaveBeenCalled()
    })

    it('supports registering many providers', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD' }),
        createTestCurrency({ code: 'EUR' }),
        createTestCurrency({ code: 'GBP' }),
      ]
      
      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      
      const provider1 = createMockProvider({
        source: 'P1',
        rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' })],
      })
      
      const provider2 = createMockProvider({
        source: 'P2',
        rates: [createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'GBP' })],
      })
      
      const provider3 = createMockProvider({
        source: 'P3',
        rates: [createTestRate({ fromCurrencyCode: 'GBP', toCurrencyCode: 'USD' })],
      })
      
      service.registerProvider(provider1)
      service.registerProvider(provider2)
      service.registerProvider(provider3)
      
      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
      
      // Assert - all three providers should be called
      expect(provider1.fetchRates).toHaveBeenCalled()
      expect(provider2.fetchRates).toHaveBeenCalled()
      expect(provider3.fetchRates).toHaveBeenCalled()
      expect(result.totalFetched).toBe(3)
    })
  })
})
