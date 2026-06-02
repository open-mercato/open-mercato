import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { ExchangeRate } from '../../data/entities'
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

const isExchangeRateCall = (call: unknown[]) => {
  const entity = call[0] as any
  return entity === ExchangeRate || entity?.name === 'ExchangeRate'
}

describe('RateFetchingService - batched persistence (issue #1399)', () => {
  let service: RateFetchingService

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('prefetches existing rates with a single query instead of one lookup per rate', async () => {
    const currencies = [
      createTestCurrency({ code: 'USD' }),
      createTestCurrency({ code: 'EUR' }),
      createTestCurrency({ code: 'GBP' }),
      createTestCurrency({ code: 'PLN' }),
    ]
    const { em } = createMockEntityManager({ currencies })
    service = new RateFetchingService(em)

    const rates = [
      createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR', source: 'BULK' }),
      createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'GBP', source: 'BULK' }),
      createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'PLN', source: 'BULK' }),
      createTestRate({ fromCurrencyCode: 'GBP', toCurrencyCode: 'PLN', source: 'BULK' }),
    ]
    service.registerProvider(createMockProvider({ source: 'BULK', rates }))

    const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)

    expect(result.totalFetched).toBe(4)
    // No per-rate point lookups.
    const findOneExchangeCalls = (em.findOne as jest.Mock).mock.calls.filter(isExchangeRateCall)
    expect(findOneExchangeCalls).toHaveLength(0)
    // Exactly one prefetch query for the whole batch.
    const findExchangeCalls = (em.find as jest.Mock).mock.calls.filter(isExchangeRateCall)
    expect(findExchangeCalls).toHaveLength(1)
    expect(findExchangeCalls[0][1]).toMatchObject({
      organizationId: TEST_SCOPE.organizationId,
      tenantId: TEST_SCOPE.tenantId,
      fromCurrencyCode: { $in: expect.arrayContaining(['USD', 'EUR', 'GBP']) },
      toCurrencyCode: { $in: expect.arrayContaining(['EUR', 'GBP', 'PLN']) },
      source: { $in: ['BULK'] },
    })
    // A single flush for the whole batch.
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('updates prefetched matches and inserts the rest in one batch', async () => {
    const currencies = [
      createTestCurrency({ code: 'USD' }),
      createTestCurrency({ code: 'EUR' }),
      createTestCurrency({ code: 'GBP' }),
    ]
    const existingRates = [
      createTestExchangeRate({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'EUR',
        rate: '0.80',
        date: TEST_DATE,
        source: 'BULK',
      }),
    ]
    const { em, persisted } = createMockEntityManager({ currencies, existingRates })
    service = new RateFetchingService(em)

    const rates = [
      // Matches the existing row -> update in memory.
      createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR', rate: '0.95', date: TEST_DATE, source: 'BULK' }),
      // New row -> insert.
      createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'GBP', rate: '0.78', date: TEST_DATE, source: 'BULK' }),
    ]
    service.registerProvider(createMockProvider({ source: 'BULK', rates }))

    const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)

    expect(result.totalFetched).toBe(2)
    // The existing entity was mutated, not duplicated.
    expect(existingRates[0].rate).toBe('0.95')
    // create() only called for the genuinely new pair.
    const createdPairs = (em.create as jest.Mock).mock.calls
      .filter(isExchangeRateCall)
      .map((call) => `${(call[1] as any).fromCurrencyCode}->${(call[1] as any).toCurrencyCode}`)
    expect(createdPairs).toEqual(['USD->GBP'])
    expect(persisted).toHaveLength(2)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('skips the database entirely when there are no valid rates', async () => {
    const currencies = [createTestCurrency({ code: 'USD' })]
    const { em } = createMockEntityManager({ currencies })
    service = new RateFetchingService(em)

    // USD->EUR is filtered out because EUR is not an active currency.
    service.registerProvider(
      createMockProvider({ source: 'BULK', rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR' })] })
    )

    const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)

    expect(result.totalFetched).toBe(0)
    // No transaction, no prefetch, no flush when nothing is storable.
    expect(em.transactional).not.toHaveBeenCalled()
    const findExchangeCalls = (em.find as jest.Mock).mock.calls.filter(isExchangeRateCall)
    expect(findExchangeCalls).toHaveLength(0)
  })
})
