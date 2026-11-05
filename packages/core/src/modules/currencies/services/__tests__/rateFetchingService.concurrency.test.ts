import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { RateFetchingService } from '../rateFetchingService'
import type { RateProvider } from '../providers/base'
import {
  createMockEntityManager,
  createMockProvider,
  createTestCurrency,
  createTestRate,
  TEST_SCOPE,
  TEST_DATE,
} from './rateFetchingService.setup'

describe('RateFetchingService - Concurrent provider fetching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('dispatches all provider fetches concurrently instead of in a sequential waterfall', async () => {
    const currencies = [
      createTestCurrency({ code: 'USD' }),
      createTestCurrency({ code: 'EUR' }),
    ]
    const { em } = createMockEntityManager({ currencies })
    const service = new RateFetchingService(em)

    let releaseSlow: (() => void) | undefined
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })

    let slowStarted = false
    let fastStartedWhileSlowPending = false

    // SLOW blocks on a gate so the fetch stays in flight; sequential code would
    // never reach FAST while SLOW is pending, so FAST.fetchRates would not be called.
    const slowProvider: RateProvider = {
      source: 'SLOW',
      name: 'SLOW',
      isAvailable: () => true,
      fetchRates: jest.fn(async () => {
        slowStarted = true
        await slowGate
        return [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR', source: 'SLOW' })]
      }),
    }

    const fastProvider: RateProvider = {
      source: 'FAST',
      name: 'FAST',
      isAvailable: () => true,
      fetchRates: jest.fn(async () => {
        if (slowStarted) fastStartedWhileSlowPending = true
        return [createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', source: 'FAST' })]
      }),
    }

    service.registerProvider(slowProvider)
    service.registerProvider(fastProvider)

    const pending = service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)

    try {
      // Let queued microtasks/timers run while SLOW is still gated.
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(slowProvider.fetchRates).toHaveBeenCalled()
      expect(fastProvider.fetchRates).toHaveBeenCalled()
      expect(fastStartedWhileSlowPending).toBe(true)
    } finally {
      releaseSlow?.()
    }

    const result = await pending
    expect(result.totalFetched).toBe(2)
    expect(result.byProvider['SLOW']).toEqual({ count: 1 })
    expect(result.byProvider['FAST']).toEqual({ count: 1 })
    expect(result.errors).toEqual([])
  })

  it('isolates a provider failure while still persisting the successful provider', async () => {
    const currencies = [
      createTestCurrency({ code: 'USD' }),
      createTestCurrency({ code: 'EUR' }),
    ]
    const { em } = createMockEntityManager({ currencies })
    const service = new RateFetchingService(em)

    const failingProvider = createMockProvider({
      source: 'FAILING',
      error: new Error('Network timeout'),
    })
    const successProvider = createMockProvider({
      source: 'SUCCESS',
      rates: [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR', source: 'SUCCESS' })],
    })

    service.registerProvider(failingProvider)
    service.registerProvider(successProvider)

    const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)

    expect(failingProvider.fetchRates).toHaveBeenCalled()
    expect(successProvider.fetchRates).toHaveBeenCalled()
    expect(result.totalFetched).toBe(1)
    expect(result.byProvider['SUCCESS']).toEqual({ count: 1 })
    expect(result.byProvider['FAILING']).toEqual({ count: 0, errors: ['Network timeout'] })
    expect(result.errors).toContain('FAILING: Network timeout')
  })

  it('persists provider results in stable provider order regardless of fetch completion order', async () => {
    const currencies = [
      createTestCurrency({ code: 'USD' }),
      createTestCurrency({ code: 'EUR' }),
    ]
    const { em } = createMockEntityManager({ currencies })
    const service = new RateFetchingService(em)

    // ALPHA resolves AFTER BETA, but must still appear first in byProvider.
    const alphaProvider: RateProvider = {
      source: 'ALPHA',
      name: 'ALPHA',
      isAvailable: () => true,
      fetchRates: jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return [createTestRate({ fromCurrencyCode: 'USD', toCurrencyCode: 'EUR', source: 'ALPHA' })]
      }),
    }
    const betaProvider: RateProvider = {
      source: 'BETA',
      name: 'BETA',
      isAvailable: () => true,
      fetchRates: jest.fn(async () =>
        [createTestRate({ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', source: 'BETA' })]
      ),
    }

    service.registerProvider(alphaProvider)
    service.registerProvider(betaProvider)

    const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)

    expect(Object.keys(result.byProvider)).toEqual(['ALPHA', 'BETA'])
    expect(result.totalFetched).toBe(2)
  })
})
