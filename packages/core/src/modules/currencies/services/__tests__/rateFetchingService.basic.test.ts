import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { RateFetchingService } from '../rateFetchingService'
import { NBPProvider } from '../providers/nbp'
import {
  createMockEntityManager,
  createMockProvider,
  createTestCurrency,
  createTestRate,
  createTestExchangeRate,
  TEST_SCOPE,
  TEST_DATE,
} from './rateFetchingService.setup'

/** Minimal NBP table C payload: one EUR row, which the provider expands into PLN→EUR and EUR→PLN. */
function nbpTableCResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => [
      {
        table: 'C',
        no: '010/C/NBP/2024',
        tradingDate: '2024-01-12',
        effectiveDate: '2024-01-15',
        rates: [{ currency: 'euro', code: 'EUR', bid: 4.3, ask: 4.5 }],
      },
    ],
  }
}

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
    it('only stores rates where both currencies exist', async () => {
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

    // `isActive` answers whether a currency may be picked for something new, which says nothing
    // about whether records already denominated in it must stay convertible. Rate fetching
    // therefore ignores it.
    it('stores rates for inactive currencies', async () => {
      // Setup - EUR is closed to new selections but existing records are still denominated in it
      const currencies = [
        createTestCurrency({ code: 'USD', isActive: true }),
        createTestCurrency({ code: 'EUR', isActive: false }),
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

      // Assert - the rate is stored, so records still held in EUR stay convertible
      expect(result.totalFetched).toBe(1)
      expect(provider.fetchRates).toHaveBeenCalledWith(
        TEST_DATE,
        TEST_SCOPE,
        new Set(['USD', 'EUR'])
      )
    })

    it('keeps an inactive base currency in the set so providers gated on it still run', async () => {
      // NBP and Raiffeisen both bail out entirely when PLN is missing from the set, so
      // deactivating PLN used to silence the whole provider, not just PLN's own pairs.
      const currencies = [
        createTestCurrency({ code: 'PLN', isActive: false }),
        createTestCurrency({ code: 'EUR', isActive: true }),
      ]

      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)

      const provider = createMockProvider({
        source: 'TEST',
        rates: [createTestRate({ fromCurrencyCode: 'PLN', toCurrencyCode: 'EUR' })],
      })

      service.registerProvider(provider)

      // Execute
      const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)

      // Assert - matched exactly: `objectContaining({ size: 2 })` would also pass for a set
      // that dropped PLN, which is the membership this test exists to pin.
      expect(provider.fetchRates).toHaveBeenCalledWith(
        TEST_DATE,
        TEST_SCOPE,
        new Set(['PLN', 'EUR'])
      )
      expect(result.totalFetched).toBe(1)
    })

    it('lets a provider gated on an inactive base currency issue its request', async () => {
      // Drives the real NBPProvider rather than a mock, so its PLN gate is the thing under
      // test: with PLN inactive the provider must still see PLN in the set and go to the
      // network. Before the fix the set arrived without PLN and the provider was silenced
      // whole — no request, no rates for any pair, not just PLN's.
      const currencies = [
        createTestCurrency({ code: 'PLN', isActive: false }),
        createTestCurrency({ code: 'EUR', isActive: true }),
      ]

      const { em } = createMockEntityManager({ currencies })
      service = new RateFetchingService(em)
      service.registerProvider(new NBPProvider())

      const fetchMock = jest.fn(async () => nbpTableCResponse())
      const originalFetch = global.fetch
      global.fetch = fetchMock as unknown as typeof fetch

      try {
        // Execute
        const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)

        // Assert - the provider ran, and both legs of the PLN/EUR pair were stored
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(result.byProvider['NBP']).toEqual({ count: 2 })
        expect(result.totalFetched).toBe(2)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('filters out rates involving soft-deleted currencies', async () => {
      // Setup
      const currencies = [
        createTestCurrency({ code: 'USD', deletedAt: null }),
        // Soft delete is what takes a currency out of rate fetching
        createTestCurrency({ code: 'EUR', deletedAt: new Date() }),
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
      
      // Assert - matched exactly rather than partially, so re-adding an `isActive` clause fails
      expect(em.find).toHaveBeenCalledWith(
        expect.anything(),
        {
          tenantId: 'tenant-123',
          organizationId: 'org-456',
          deletedAt: null,
        }
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
