import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { ExchangeRateService } from '../exchangeRateService'
import { RateFetchingService } from '../rateFetchingService'
import {
  createMockEntityManager,
  createTestExchangeRate,
  TEST_SCOPE,
} from './rateFetchingService.setup'

describe('ExchangeRateService', () => {
  let service: ExchangeRateService
  let rateFetchingService: RateFetchingService
  let mockEm: ReturnType<typeof createMockEntityManager>['em']

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getRate - basic functionality', () => {
    it('returns existing rate when found in database', async () => {
      const testDate = new Date('2024-01-15T10:00:00Z')
      const normalizedDate = new Date('2024-01-15T00:00:00Z')
      
      const existingRate = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.92',
        date: normalizedDate,
        source: 'TEST',
      })

      const { em } = createMockEntityManager({
        existingRates: [existingRate],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: testDate,
        scope: TEST_SCOPE,
      })

      expect(result.rates).toHaveLength(1)
      expect(result.rates[0].rate).toBe('0.92')
      expect(result.fromCurrencyCode).toBe('USD')
      expect(result.toCurrencyCode).toBe('EUR')
      expect(result.actualDate).toEqual(normalizedDate)
      expect(result.requestedDate).toEqual(testDate)
    })

    it('returns multiple rates from different providers', async () => {
      const testDate = new Date('2024-01-15T10:00:00Z')
      const normalizedDate = new Date('2024-01-15T00:00:00Z')
      
      const rate1 = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.92',
        date: normalizedDate,
        source: 'PROVIDER1',
      })

      const rate2 = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.921',
        date: normalizedDate,
        source: 'PROVIDER2',
      })

      const { em } = createMockEntityManager({
        existingRates: [rate1, rate2],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: testDate,
        scope: TEST_SCOPE,
      })

      expect(result.rates).toHaveLength(2)
      expect(result.rates[0].source).toBe('PROVIDER1')
      expect(result.rates[1].source).toBe('PROVIDER2')
    })

    it('normalizes currency codes to uppercase', async () => {
      const testDate = new Date('2024-01-15T10:00:00Z')
      const normalizedDate = new Date('2024-01-15T00:00:00Z')
      
      const existingRate = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.92',
        date: normalizedDate,
        source: 'TEST',
      })

      const { em } = createMockEntityManager({
        existingRates: [existingRate],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'usd',
        toCurrencyCode: 'eur',
        date: testDate,
        scope: TEST_SCOPE,
      })

      expect(result.rates).toHaveLength(1)
      expect(result.fromCurrencyCode).toBe('USD')
      expect(result.toCurrencyCode).toBe('EUR')
    })

    it('normalizes date to start of day UTC', async () => {
      const testDate = new Date('2024-01-15T14:30:45.123Z')
      const normalizedDate = new Date('2024-01-15T00:00:00Z')
      
      const existingRate = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.92',
        date: normalizedDate,
        source: 'TEST',
      })

      const { em } = createMockEntityManager({
        existingRates: [existingRate],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: testDate,
        scope: TEST_SCOPE,
      })

      expect(result.rates).toHaveLength(1)
      expect(result.actualDate).toEqual(normalizedDate)
    })

    it('throws error for same currency exchange', async () => {
      const { em } = createMockEntityManager({})
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      await expect(
        service.getRate({
          fromCurrencyCode: 'USD',
          toCurrencyCode: 'USD',
          date: new Date(),
          scope: TEST_SCOPE,
        })
      ).rejects.toThrow('Cannot get exchange rate for the same currency')
    })
  })

  describe('getRate - daily fallback behavior', () => {
    it('falls back to previous day when rate not found', async () => {
      const requestedDate = new Date('2024-01-15T00:00:00Z')
      const previousDayDate = new Date('2024-01-14T00:00:00Z')
      
      const previousDayRate = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.91',
        date: previousDayDate,
        source: 'TEST',
      })

      const { em } = createMockEntityManager({
        existingRates: [previousDayRate],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: requestedDate,
        scope: TEST_SCOPE,
        options: { autoFetch: false },
      })

      expect(result.rates).toHaveLength(1)
      expect(result.rates[0].rate).toBe('0.91')
      expect(result.actualDate).toEqual(previousDayDate)
      expect(result.requestedDate).toEqual(requestedDate)
    })

    it('falls back multiple days when needed', async () => {
      const requestedDate = new Date('2024-01-15T00:00:00Z')
      const threeDaysBackDate = new Date('2024-01-12T00:00:00Z')
      
      const oldRate = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.90',
        date: threeDaysBackDate,
        source: 'TEST',
      })

      const { em } = createMockEntityManager({
        existingRates: [oldRate],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: requestedDate,
        scope: TEST_SCOPE,
        options: { autoFetch: false },
      })

      expect(result.rates).toHaveLength(1)
      expect(result.rates[0].rate).toBe('0.90')
      expect(result.actualDate).toEqual(threeDaysBackDate)
    })

    it('respects maxDaysBack limit', async () => {
      const requestedDate = new Date('2024-01-15T00:00:00Z')
      const tenDaysBackDate = new Date('2024-01-05T00:00:00Z')
      
      const oldRate = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.90',
        date: tenDaysBackDate,
        source: 'TEST',
      })

      const { em } = createMockEntityManager({
        existingRates: [oldRate],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: requestedDate,
        scope: TEST_SCOPE,
        options: { autoFetch: false, maxDaysBack: 5 },
      })

      expect(result.rates).toHaveLength(0)
      expect(result.actualDate).toBeNull()
    })

    it('returns empty result when no rate found within limit', async () => {
      const { em } = createMockEntityManager({
        existingRates: [],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: new Date('2024-01-15T00:00:00Z'),
        scope: TEST_SCOPE,
        options: { autoFetch: false, maxDaysBack: 5 },
      })

      expect(result.rates).toHaveLength(0)
      expect(result.actualDate).toBeNull()
    })
  })

  describe('getRate - auto-fetch behavior', () => {
    it('fetches from providers when rate not found and autoFetch is true', async () => {
      const requestedDate = new Date('2024-01-15T00:00:00Z')
      const normalizedDate = new Date('2024-01-15T00:00:00Z')
      
      const fetchedRate = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.92',
        date: normalizedDate,
        source: 'NBP',
      })

      const { em } = createMockEntityManager({
        existingRates: [],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      
      // Mock the fetch service to return success and populate the DB
      jest.spyOn(rateFetchingService, 'fetchRatesForDate').mockImplementation(async (date, scope, options) => {
        // Simulate DB population after fetch
        const findMock = em.find as jest.MockedFunction<any>
        findMock.mockResolvedValueOnce([fetchedRate])
        
        return {
          totalFetched: 1,
          byProvider: { NBP: { count: 1 } } as Record<string, { count: number; errors?: string[] }>,
          errors: [],
        }
      })

      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: requestedDate,
        scope: TEST_SCOPE,
        options: { autoFetch: true },
      })

      expect(rateFetchingService.fetchRatesForDate).toHaveBeenCalledWith(
        normalizedDate,
        TEST_SCOPE
      )
      expect(result.rates).toHaveLength(1)
      expect(result.rates[0].rate).toBe('0.92')
    })

    it('falls back to previous day when fetch returns no data', async () => {
      const requestedDate = new Date('2024-01-15T00:00:00Z')
      const previousDayDate = new Date('2024-01-14T00:00:00Z')
      
      const previousDayRate = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.91',
        date: previousDayDate,
        source: 'NBP',
      })

      const { em } = createMockEntityManager({
        existingRates: [],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      
      let callCount = 0
      jest.spyOn(rateFetchingService, 'fetchRatesForDate').mockImplementation(async (date, scope, options) => {
        callCount++
        
        // First call (Jan 15): return nothing
        if (callCount === 1) {
          return {
            totalFetched: 0,
            byProvider: {} as Record<string, { count: number; errors?: string[] }>,
            errors: [],
          }
        }
        
        // Second call (Jan 14): return rate
        const findMock = em.find as jest.MockedFunction<any>
        findMock.mockResolvedValueOnce([previousDayRate])
        
        return {
          totalFetched: 1,
          byProvider: { NBP: { count: 1 } } as Record<string, { count: number; errors?: string[] }>,
          errors: [],
        }
      })

      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: requestedDate,
        scope: TEST_SCOPE,
        options: { autoFetch: true },
      })

      expect(rateFetchingService.fetchRatesForDate).toHaveBeenCalledTimes(2)
      expect(result.rates).toHaveLength(1)
      expect(result.actualDate).toEqual(previousDayDate)
    })

    it('does not fetch when autoFetch is false', async () => {
      const { em } = createMockEntityManager({
        existingRates: [],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      jest.spyOn(rateFetchingService, 'fetchRatesForDate')
      
      service = new ExchangeRateService(em, rateFetchingService)

      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: new Date('2024-01-15T00:00:00Z'),
        scope: TEST_SCOPE,
        options: { autoFetch: false, maxDaysBack: 5 },
      })

      expect(rateFetchingService.fetchRatesForDate).not.toHaveBeenCalled()
      expect(result.rates).toHaveLength(0)
    })
  })

  describe('getRates - batch operations', () => {
    it('fetches multiple currency pairs at once', async () => {
      const testDate = new Date('2024-01-15T00:00:00Z')
      const normalizedDate = new Date('2024-01-15T00:00:00Z')
      
      const rate1 = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.92',
        date: normalizedDate,
        source: 'TEST',
      })

      const rate2 = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'GBP',
        rate: '0.79',
        date: normalizedDate,
        source: 'TEST',
      })

      const { em } = createMockEntityManager({
        existingRates: [rate1, rate2],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const results = await service.getRates({
        pairs: [
          { fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' },
          { fromCurrencyCode: 'USD', toCurrencyCode: 'GBP' },
        ],
        date: testDate,
        scope: TEST_SCOPE,
        options: { autoFetch: false },
      })

      expect(results.size).toBe(2)
      
      const usdEur = results.get('USD/EUR')
      expect(usdEur?.rates).toHaveLength(1)
      expect(usdEur?.rates[0].rate).toBe('0.92')
      
      const usdGbp = results.get('USD/GBP')
      expect(usdGbp?.rates).toHaveLength(1)
      expect(usdGbp?.rates[0].rate).toBe('0.79')
    })

    it('handles partial failures in batch operations', async () => {
      const testDate = new Date('2024-01-15T00:00:00Z')
      const normalizedDate = new Date('2024-01-15T00:00:00Z')
      
      const rate1 = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.92',
        date: normalizedDate,
        source: 'TEST',
      })

      const { em } = createMockEntityManager({
        existingRates: [rate1],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const results = await service.getRates({
        pairs: [
          { fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' },
          { fromCurrencyCode: 'USD', toCurrencyCode: 'XYZ' }, // Non-existent
        ],
        date: testDate,
        scope: TEST_SCOPE,
        options: { autoFetch: false, maxDaysBack: 2 },
      })

      expect(results.size).toBe(2)
      
      const usdEur = results.get('USD/EUR')
      expect(usdEur?.rates).toHaveLength(1)
      
      const usdXyz = results.get('USD/XYZ')
      expect(usdXyz?.rates).toHaveLength(0)
      expect(usdXyz?.actualDate).toBeNull()
    })

    it('captures errors in error field for batch operations', async () => {
      const testDate = new Date('2024-01-15T00:00:00Z')
      const normalizedDate = new Date('2024-01-15T00:00:00Z')
      
      const rate1 = createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.92',
        date: normalizedDate,
        source: 'TEST',
      })

      const { em } = createMockEntityManager({
        existingRates: [rate1],
      })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      const results = await service.getRates({
        pairs: [
          { fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' },  // Success
          { fromCurrencyCode: 'USD', toCurrencyCode: 'USD' },  // Error: same currency
        ],
        date: testDate,
        scope: TEST_SCOPE,
        options: { autoFetch: false },
      })

      expect(results.size).toBe(2)
      
      // Success case
      const usdEur = results.get('USD/EUR')
      expect(usdEur?.rates).toHaveLength(1)
      expect(usdEur?.error).toBeUndefined()
      
      // Error case
      const usdUsd = results.get('USD/USD')
      expect(usdUsd?.rates).toHaveLength(0)
      expect(usdUsd?.error).toBeDefined()
      expect(usdUsd?.error).toBeInstanceOf(Error)
      expect(usdUsd?.error?.message).toContain('same currency')
    })
  })

  describe('date validation', () => {
    beforeEach(() => {
      const { em } = createMockEntityManager({})
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)
    })

    it('throws error for future dates', async () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)

      await expect(
        service.getRate({
          fromCurrencyCode: 'USD',
          toCurrencyCode: 'EUR',
          date: tomorrow,
          scope: TEST_SCOPE,
        })
      ).rejects.toThrow('Cannot get exchange rate for a future date')
    })

    it('throws error for dates far in the future', async () => {
      const futureDate = new Date('2050-12-31T00:00:00Z')

      await expect(
        service.getRate({
          fromCurrencyCode: 'USD',
          toCurrencyCode: 'EUR',
          date: futureDate,
          scope: TEST_SCOPE,
        })
      ).rejects.toThrow('Cannot get exchange rate for a future date')
    })

    it('allows today', async () => {
      const today = new Date()
      
      const { em } = createMockEntityManager({ existingRates: [] })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      // Should not throw
      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: today,
        scope: TEST_SCOPE,
        options: { autoFetch: false, maxDaysBack: 0 },
      })

      expect(result).toBeDefined()
      expect(result.requestedDate).toBeDefined()
    })

    it('allows past dates', async () => {
      const pastDate = new Date('2024-01-01T00:00:00Z')
      
      const { em } = createMockEntityManager({ existingRates: [] })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      // Should not throw
      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: pastDate,
        scope: TEST_SCOPE,
        options: { autoFetch: false, maxDaysBack: 0 },
      })

      expect(result).toBeDefined()
    })

    it('allows very old dates without minimum constraint', async () => {
      const veryOldDate = new Date('1950-01-01T00:00:00Z')
      
      const { em } = createMockEntityManager({ existingRates: [] })
      mockEm = em
      rateFetchingService = new RateFetchingService(em)
      service = new ExchangeRateService(em, rateFetchingService)

      // Should not throw
      const result = await service.getRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        date: veryOldDate,
        scope: TEST_SCOPE,
        options: { autoFetch: false, maxDaysBack: 0 },
      })

      expect(result).toBeDefined()
      expect(result.rates).toHaveLength(0) // No data, but no error
    })

    it('validates date in batch operations', async () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)

      const results = await service.getRates({
        pairs: [
          { fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' },
        ],
        date: tomorrow,
        scope: TEST_SCOPE,
      })

      const usdEur = results.get('USD/EUR')
      expect(usdEur?.error).toBeDefined()
      expect(usdEur?.error?.message).toContain('future date')
    })
  })
})
