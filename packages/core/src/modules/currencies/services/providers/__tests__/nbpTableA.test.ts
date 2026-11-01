import { describe, it, expect, jest, afterEach } from '@jest/globals'
import { NBPTableAProvider } from '../nbpTableA'
import { ExchangeRateService } from '../../exchangeRateService'
import { RateFetchingService } from '../../rateFetchingService'
import { createMockEntityManager, createTestCurrency, TEST_SCOPE as SERVICE_SCOPE } from '../../__tests__/rateFetchingService.setup'

const TEST_DATE = new Date('2026-10-22T00:00:00.000Z')
const TEST_SCOPE = { tenantId: 'test-tenant', organizationId: 'test-org' }

function tableAResponse(effectiveDate = '2026-10-22'): Response {
  return new Response(
    JSON.stringify([
      {
        table: 'A',
        no: '205/A/NBP/2026',
        effectiveDate,
        rates: [
          { currency: 'euro', code: 'EUR', mid: 4.3012 },
          { currency: 'dolar amerykański', code: 'USD', mid: 3.9987 },
        ],
      },
    ]),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

describe('NBPTableAProvider', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('exposes the NBP_A source and PLN as its base currency', () => {
    const provider = new NBPTableAProvider()
    expect(provider.source).toBe('NBP_A')
    expect(provider.providerBaseCurrency).toBe('PLN')
    expect(provider.isAvailable()).toBe(true)
  })

  it('requests Table A for the date and returns XXX -> PLN mid rates without a type', async () => {
    const fetchMock = jest.fn(async () => tableAResponse())
    global.fetch = fetchMock as unknown as typeof fetch

    const rates = await new NBPTableAProvider().fetchRates(
      TEST_DATE,
      TEST_SCOPE,
      new Set(['PLN', 'EUR', 'USD'])
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(
      'https://api.nbp.pl/api/exchangerates/tables/a/2026-10-22/?format=json'
    )
    expect(rates).toHaveLength(2)
    expect(rates[0]).toMatchObject({
      fromCurrencyCode: 'EUR',
      toCurrencyCode: 'PLN',
      rate: '4.3012',
      source: 'NBP_A',
      type: null,
    })
    expect(rates[1]).toMatchObject({ fromCurrencyCode: 'USD', toCurrencyCode: 'PLN', rate: '3.9987' })
  })

  it('stamps rows with the table effective date at UTC midnight, the instant getRate matches on', async () => {
    global.fetch = jest.fn(async () => tableAResponse('2026-10-22')) as unknown as typeof fetch

    const rates = await new NBPTableAProvider().fetchRates(TEST_DATE, TEST_SCOPE, new Set(['PLN', 'EUR']))

    // Not Warsaw midnight (2026-10-21T22:00Z in CEST): ExchangeRateService.normalizeDate looks rows up
    // by exact UTC midnight, so a Warsaw-midnight stamp would never be found.
    expect(rates[0].date.toISOString()).toBe('2026-10-22T00:00:00.000Z')
  })

  it('returns no rates for a date without a published table (404)', async () => {
    global.fetch = jest.fn(
      async () => new Response('404 NotFound', { status: 404 })
    ) as unknown as typeof fetch

    const rates = await new NBPTableAProvider().fetchRates(TEST_DATE, TEST_SCOPE, new Set(['PLN', 'EUR']))

    expect(rates).toEqual([])
  })

  it('throws on other API errors', async () => {
    global.fetch = jest.fn(
      async () => new Response('boom', { status: 500, statusText: 'Server Error' })
    ) as unknown as typeof fetch

    await expect(
      new NBPTableAProvider().fetchRates(TEST_DATE, TEST_SCOPE, new Set(['PLN', 'EUR']))
    ).rejects.toThrow('Failed to fetch NBP Table A rates')
  })

  it('issues no request when PLN is absent from the currency set', async () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const rates = await new NBPTableAProvider().fetchRates(TEST_DATE, TEST_SCOPE, new Set(['USD', 'EUR']))

    expect(rates).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('NBP_A stored by the fetch flow and read back by ExchangeRateService.getRate', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  // Only the Friday 16 Oct 2026 table exists; every other day answers 404 like NBP does
  const nbpFetch = jest.fn(async (input: unknown) => {
    const url = String(input)
    return url.includes('/tables/a/2026-10-16/') ? tableAResponse('2026-10-16') : new Response('', { status: 404 })
  })

  const build = () => {
    const store: any[] = []
    const { em } = createMockEntityManager({
      currencies: [createTestCurrency({ code: 'PLN', isBase: true }), createTestCurrency({ code: 'EUR' })],
      existingRates: store,
    })
    // The mock keeps persisted rows apart from the rows `find` reads: feed them back, like a real table
    ;(em.persist as jest.Mock).mockImplementation((row: any) => {
      store.push({ isActive: true, deletedAt: null, ...row })
    })
    const fetching = new RateFetchingService(em)
    fetching.registerProvider(new NBPTableAProvider())
    return { store, svc: new ExchangeRateService(em, fetching) }
  }

  it('finds the rate of the requested day on the first lookup', async () => {
    global.fetch = nbpFetch as unknown as typeof fetch
    const { store, svc } = build()

    const result = await svc.getRate({
      fromCurrencyCode: 'EUR',
      toCurrencyCode: 'PLN',
      date: new Date('2026-10-16T00:00:00.000Z'),
      scope: SERVICE_SCOPE,
      source: 'NBP_A',
    })

    expect(store).toHaveLength(1)
    expect(store[0].date.toISOString()).toBe('2026-10-16T00:00:00.000Z')
    expect(result.rates.map((r) => r.rate)).toEqual(['4.3012'])
    expect(result.actualDate?.toISOString()).toBe('2026-10-16T00:00:00.000Z')
  })

  it('steps back from a Sunday to the last published table', async () => {
    global.fetch = nbpFetch as unknown as typeof fetch
    const { svc } = build()

    const result = await svc.getRate({
      fromCurrencyCode: 'EUR',
      toCurrencyCode: 'PLN',
      date: new Date('2026-10-18T00:00:00.000Z'),
      scope: SERVICE_SCOPE,
      source: 'NBP_A',
    })

    expect(result.rates.map((r) => r.rate)).toEqual(['4.3012'])
    expect(result.actualDate?.toISOString()).toBe('2026-10-16T00:00:00.000Z')
  })
})
