import { describe, expect, it } from '@jest/globals'
import { RateFetchingService } from '../rateFetchingService'
import { RateProviderError } from '../providers/base'
import {
  createMockEntityManager,
  createMockProvider,
  createTestCurrency,
  createTestRate,
  TEST_DATE,
  TEST_SCOPE,
} from './rateFetchingService.setup'

describe('RateFetchingService explicit provider selection', () => {
  it('skips explicit providers by default and includes them when selected', async () => {
    const { em } = createMockEntityManager({
      currencies: [createTestCurrency({ code: 'USD' }), createTestCurrency({ code: 'PLN' })],
    })
    const service = new RateFetchingService(em)
    const defaultProvider = createMockProvider({
      source: 'default',
      rates: [createTestRate({ toCurrencyCode: 'PLN', source: 'default' })],
    })
    const explicitProvider = createMockProvider({
      source: 'explicit',
      selectionMode: 'explicit',
      rates: [createTestRate({ toCurrencyCode: 'PLN', source: 'explicit' })],
    })
    service.registerProvider(defaultProvider)
    service.registerProvider(explicitProvider)

    await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)
    expect(defaultProvider.fetchRates).toHaveBeenCalledTimes(1)
    expect(explicitProvider.fetchRates).not.toHaveBeenCalled()
    expect(service.hasProvider('explicit')).toBe(true)
    expect(service.getProviderSources()).toEqual(['default', 'explicit'])
    expect(service.getProviderSources('default')).toEqual(['default'])
    expect(service.getProviderSources('explicit')).toEqual(['explicit'])

    await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE, { providers: ['explicit'] })
    expect(explicitProvider.fetchRates).toHaveBeenCalledTimes(1)
  })

  it('rejects conflicting duplicate batches before opening a transaction', async () => {
    const { em } = createMockEntityManager({
      currencies: [createTestCurrency({ code: 'USD' }), createTestCurrency({ code: 'PLN' })],
    })
    const service = new RateFetchingService(em)
    service.registerProvider(createMockProvider({
      source: 'duplicate',
      rates: [
        createTestRate({ toCurrencyCode: 'PLN', source: 'duplicate', type: 'buy' }),
        createTestRate({ toCurrencyCode: 'PLN', source: 'duplicate', type: 'average' }),
      ],
    }))

    const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)

    expect(result.totalFetched).toBe(0)
    expect(result.byProvider.duplicate.errors?.[0]).toContain('Conflicting rate types')
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('persists the provider publication reference with an average rate', async () => {
    const { em, persisted } = createMockEntityManager({
      currencies: [createTestCurrency({ code: 'USD' }), createTestCurrency({ code: 'PLN' })],
    })
    const service = new RateFetchingService(em)
    service.registerProvider(createMockProvider({
      source: 'nbp_average',
      selectionMode: 'explicit',
      rates: [createTestRate({
        toCurrencyCode: 'PLN',
        source: 'nbp_average',
        type: 'average',
        externalReference: '163/A/NBP/2026',
      })],
    }))

    const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE, {
      providers: ['nbp_average'],
    })

    expect(result.totalFetched).toBe(1)
    expect(persisted).toContainEqual(expect.objectContaining({
      source: 'nbp_average',
      type: 'average',
      externalReference: '163/A/NBP/2026',
    }))
  })

  it('rejects conflicting publication references before opening a transaction', async () => {
    const { em } = createMockEntityManager({
      currencies: [createTestCurrency({ code: 'USD' }), createTestCurrency({ code: 'PLN' })],
    })
    const service = new RateFetchingService(em)
    service.registerProvider(createMockProvider({
      source: 'duplicate',
      rates: [
        createTestRate({
          toCurrencyCode: 'PLN',
          source: 'duplicate',
          type: 'average',
          externalReference: '163/A/NBP/2026',
        }),
        createTestRate({
          toCurrencyCode: 'PLN',
          source: 'duplicate',
          type: 'average',
          externalReference: '164/A/NBP/2026',
        }),
      ],
    }))

    const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE)

    expect(result.totalFetched).toBe(0)
    expect(result.byProvider.duplicate.errors?.[0]).toContain('Conflicting rates')
    expect(em.transactional).not.toHaveBeenCalled()
  })

  it('localizes provider errors through the supplied translator', async () => {
    const { em } = createMockEntityManager({
      currencies: [createTestCurrency({ code: 'USD' }), createTestCurrency({ code: 'PLN' })],
    })
    const service = new RateFetchingService(em)
    service.registerProvider(createMockProvider({
      source: 'nbp_average',
      selectionMode: 'explicit',
      error: new RateProviderError(
        'currencies.fetch.provider_error.table_request_failed',
        'NBP table A request failed with status 503',
        { table: 'A', status: 503 },
      ),
    }))
    const translate = (key: string) => `translated:${key}`

    const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE, {
      providers: ['nbp_average'],
      translate,
    })

    expect(result.errors).toEqual([
      'nbp_average: translated:currencies.fetch.provider_error.table_request_failed',
    ])
    expect(result.byProvider.nbp_average).toEqual({
      count: 0,
      errors: ['translated:currencies.fetch.provider_error.table_request_failed'],
    })
  })

  it('keeps the provider fallback message when no translator is supplied', async () => {
    const { em } = createMockEntityManager({
      currencies: [createTestCurrency({ code: 'USD' }), createTestCurrency({ code: 'PLN' })],
    })
    const service = new RateFetchingService(em)
    service.registerProvider(createMockProvider({
      source: 'nbp_average',
      selectionMode: 'explicit',
      error: new RateProviderError(
        'currencies.fetch.provider_error.table_invalid_json',
        'NBP table B returned invalid JSON',
        { table: 'B' },
      ),
    }))

    const result = await service.fetchRatesForDate(TEST_DATE, TEST_SCOPE, {
      providers: ['nbp_average'],
    })

    expect(result.errors).toEqual(['nbp_average: NBP table B returned invalid JSON'])
  })
})
