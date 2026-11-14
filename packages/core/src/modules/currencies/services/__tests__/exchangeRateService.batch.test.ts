import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { ExchangeRateService } from '../exchangeRateService'
import { RateFetchingService } from '../rateFetchingService'
import { ExchangeRate } from '../../data/entities'
import { createMockEntityManager, createTestExchangeRate } from './rateFetchingService.setup'

const tenantId = 'test-tenant'
const orgA = 'org-a'
const orgB = 'org-b'
const orgC = 'org-c'
const requestDate = new Date('2024-03-10T14:30:00Z')

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

function exchangeRateFinds(em: { find: jest.Mock }): number {
  return em.find.mock.calls.filter(([entity]) => entity === ExchangeRate).length
}

function buildService(existingRates: ExchangeRate[]) {
  const { em } = createMockEntityManager({ existingRates })
  const service = new ExchangeRateService(em, new RateFetchingService(em))
  return { em: em as unknown as { find: jest.Mock }, service }
}

describe('ExchangeRateService.getStoredRatesForOrganizations', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('resolves every organization with its own stored rates and never borrows another organization\'s rate', async () => {
    const { service } = buildService([
      createTestExchangeRate({ organizationId: orgA, tenantId, fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.10', date: day('2024-03-10') }),
      createTestExchangeRate({ organizationId: orgB, tenantId, fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.20', date: day('2024-03-08') }),
    ])

    const result = await service.getStoredRatesForOrganizations({
      tenantId,
      date: requestDate,
      maxDaysBack: 60,
      requests: [
        { organizationId: orgA, pairs: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }, { fromCurrencyCode: 'GBP', toCurrencyCode: 'USD' }] },
        { organizationId: orgB, pairs: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }] },
        { organizationId: orgC, pairs: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }] },
      ],
    })

    expect(result.get(orgA)?.get('EUR/USD')?.rates.map((rate) => rate.rate)).toEqual(['1.10'])
    expect(result.get(orgA)?.get('EUR/USD')?.actualDate).toEqual(day('2024-03-10'))
    expect(result.get(orgA)?.get('GBP/USD')?.rates).toEqual([])
    expect(result.get(orgA)?.get('GBP/USD')?.actualDate).toBeNull()
    expect(result.get(orgB)?.get('EUR/USD')?.rates.map((rate) => rate.rate)).toEqual(['1.20'])
    expect(result.get(orgB)?.get('EUR/USD')?.actualDate).toEqual(day('2024-03-08'))
    expect(result.get(orgC)?.get('EUR/USD')?.rates).toEqual([])
    expect(result.get(orgC)?.get('EUR/USD')?.actualDate).toBeNull()
  })

  it('matches getRate: the most recent stored day inside the window wins, older and out-of-window days are ignored', async () => {
    const rows = [
      createTestExchangeRate({ organizationId: orgA, tenantId, fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.05', date: day('2024-03-01'), source: 'OLD' }),
      createTestExchangeRate({ organizationId: orgA, tenantId, fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.11', date: day('2024-03-07'), source: 'P1' }),
      createTestExchangeRate({ organizationId: orgA, tenantId, fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.12', date: day('2024-03-07'), source: 'P2' }),
      createTestExchangeRate({ organizationId: orgA, tenantId, fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '9.99', date: new Date('2024-03-09T10:15:00Z'), source: 'MINUTE' }),
      createTestExchangeRate({ organizationId: orgB, tenantId, fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', rate: '1.30', date: day('2024-01-01') }),
    ]
    const { service } = buildService(rows)

    const batched = await service.getStoredRatesForOrganizations({
      tenantId,
      date: requestDate,
      maxDaysBack: 30,
      requests: [
        { organizationId: orgA, pairs: [{ fromCurrencyCode: 'eur', toCurrencyCode: 'usd' }] },
        { organizationId: orgB, pairs: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }] },
      ],
    })

    for (const organizationId of [orgA, orgB]) {
      const single = await service.getRate({
        fromCurrencyCode: 'EUR',
        toCurrencyCode: 'USD',
        date: requestDate,
        scope: { tenantId, organizationId },
        options: { maxDaysBack: 30, autoFetch: false },
      })
      const fromBatch = batched.get(organizationId)?.get('EUR/USD')
      expect(fromBatch?.actualDate).toEqual(single.actualDate)
      expect(fromBatch?.rates.map((rate) => rate.rate).sort()).toEqual(single.rates.map((rate) => rate.rate).sort())
    }
    expect(batched.get(orgA)?.get('EUR/USD')?.rates.map((rate) => rate.rate).sort()).toEqual(['1.11', '1.12'])
    expect(batched.get(orgB)?.get('EUR/USD')?.rates).toEqual([])
  })

  it('reads all organizations, pairs and days in one statement where per-organization getRates needs one per day', async () => {
    const organizations = [orgA, orgB, orgC]
    const maxDaysBack = 60

    const serial = buildService([])
    for (const organizationId of organizations) {
      await serial.service.getRates({
        pairs: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }],
        date: requestDate,
        scope: { tenantId, organizationId },
        options: { maxDaysBack, autoFetch: false },
      })
    }
    expect(exchangeRateFinds(serial.em)).toBe(organizations.length * (maxDaysBack + 1))

    const batched = buildService([])
    const result = await batched.service.getStoredRatesForOrganizations({
      tenantId,
      date: requestDate,
      maxDaysBack,
      requests: organizations.map((organizationId) => ({
        organizationId,
        pairs: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }],
      })),
    })
    expect(exchangeRateFinds(batched.em)).toBe(1)
    for (const organizationId of organizations) {
      expect(result.get(organizationId)?.get('EUR/USD')?.rates).toEqual([])
    }
  })

  it('scopes the single statement to the tenant, the requested organizations and stored active rows', async () => {
    const { em, service } = buildService([])

    await service.getStoredRatesForOrganizations({
      tenantId,
      date: requestDate,
      maxDaysBack: 2,
      requests: [{ organizationId: orgA, pairs: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }] }],
    })

    const [, filter] = em.find.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(filter).toMatchObject({
      tenantId,
      organizationId: { $in: [orgA] },
      fromCurrencyCode: { $in: ['EUR'] },
      toCurrencyCode: { $in: ['USD'] },
      deletedAt: null,
      isActive: true,
    })
    expect(filter.date).toEqual({ $in: [day('2024-03-10'), day('2024-03-09'), day('2024-03-08')] })
  })

  it('does not query when nothing is requested', async () => {
    const { em, service } = buildService([])

    const result = await service.getStoredRatesForOrganizations({ tenantId, date: requestDate, requests: [] })

    expect(result.size).toBe(0)
    expect(em.find).not.toHaveBeenCalled()
  })
})
