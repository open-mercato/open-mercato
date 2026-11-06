import { describe, expect, it } from '@jest/globals'
import { RateFetchingService } from '../rateFetchingService'
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
})
