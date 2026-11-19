import { describe, expect, it, jest } from '@jest/globals'
import { ExchangeRateService } from '../exchangeRateService'
import { RateFetchingService } from '../rateFetchingService'
import { ExchangeRate } from '../../data/entities'
import {
  createMockEntityManager,
  createMockProvider,
  createTestExchangeRate,
  TEST_SCOPE,
} from './rateFetchingService.setup'

describe('ExchangeRateService explicit rate selection', () => {
  it('keeps arbitrary legacy entity rate types assignable', () => {
    const customType: string = 'legacy-custom-type'
    const rate = new ExchangeRate()
    rate.type = customType
    expect(rate.type).toBe(customType)
  })

  it('accepts legacy lookback values above one year for unfiltered reads', async () => {
    const date = new Date('2024-03-31T00:00:00.000Z')
    const existingRate = createTestExchangeRate({ date, source: 'default' })
    const { em } = createMockEntityManager({ existingRates: [existingRate] })
    const service = new ExchangeRateService(em, new RateFetchingService(em))

    const result = await service.getRate({
      fromCurrencyCode: 'USD',
      toCurrencyCode: 'EUR',
      date,
      scope: TEST_SCOPE,
      options: { autoFetch: false, maxDaysBack: 730 },
    })

    expect(result.rates).toHaveLength(1)
    expect(result.rates[0].source).toBe('default')
  })

  it('bounds the lookback for explicit rate selection', async () => {
    const { em } = createMockEntityManager({})
    const service = new ExchangeRateService(em, new RateFetchingService(em))
    await expect(service.getRate({
      fromCurrencyCode: 'USD',
      toCurrencyCode: 'EUR',
      date: new Date('2024-03-31T00:00:00.000Z'),
      scope: TEST_SCOPE,
      options: { autoFetch: false, rateType: 'average', maxDaysBack: 730 },
    })).rejects.toThrow('maxDaysBack')
    expect(em.find).not.toHaveBeenCalled()
  })

  it('excludes registered explicit sources from unfiltered reads', async () => {
    const date = new Date('2024-03-31T00:00:00.000Z')
    const { em } = createMockEntityManager({
      existingRates: [
        createTestExchangeRate({ date, source: 'default' }),
        createTestExchangeRate({ date, source: 'nbp_average', type: 'average' }),
      ],
    })
    const fetching = new RateFetchingService(em)
    fetching.registerProvider(createMockProvider({ source: 'default' }))
    fetching.registerProvider(createMockProvider({ source: 'nbp_average', selectionMode: 'explicit' }))
    const service = new ExchangeRateService(em, fetching)

    const result = await service.getRate({
      fromCurrencyCode: 'USD',
      toCurrencyCode: 'EUR',
      date,
      scope: TEST_SCOPE,
      options: { autoFetch: false, maxDaysBack: 0 },
    })

    expect(result.rates.map((rate) => rate.source)).toEqual(['default'])
  })

  it('filters an explicit provider and rate type and forwards it to auto-fetch', async () => {
    const date = new Date('2024-01-15T00:00:00.000Z')
    const { em } = createMockEntityManager({ existingRates: [] })
    const fetching = new RateFetchingService(em)
    fetching.registerProvider(createMockProvider({ source: 'nbp_average', selectionMode: 'explicit' }))
    const fetch = jest.spyOn(fetching, 'fetchRatesForDate').mockResolvedValue({
      totalFetched: 0,
      byProvider: {},
      errors: [],
    })
    const service = new ExchangeRateService(em, fetching)

    await service.getRate({
      fromCurrencyCode: 'USD',
      toCurrencyCode: 'PLN',
      date,
      scope: TEST_SCOPE,
      options: { provider: ' nbp_average ', rateType: 'average', maxDaysBack: 0 },
    })

    expect(fetch).toHaveBeenCalledWith(date, TEST_SCOPE, { providers: ['nbp_average'] })
    expect(em.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: 'nbp_average',
      type: 'average',
    }))
  })

  it('rejects invalid selectors before querying or fetching', async () => {
    const { em } = createMockEntityManager({})
    const fetching = new RateFetchingService(em)
    const service = new ExchangeRateService(em, fetching)

    await expect(service.getRate({
      fromCurrencyCode: 'USD',
      toCurrencyCode: 'PLN',
      date: new Date('2024-01-15T00:00:00.000Z'),
      scope: TEST_SCOPE,
      options: { provider: 'missing' },
    })).rejects.toThrow('registered rate provider')

    expect(em.find).not.toHaveBeenCalled()
  })
})
