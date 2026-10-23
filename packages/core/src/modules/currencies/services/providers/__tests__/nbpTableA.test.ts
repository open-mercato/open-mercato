import { describe, it, expect, jest, afterEach } from '@jest/globals'
import { NBPTableAProvider } from '../nbpTableA'

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

  it('stamps rows with the table effective date as Warsaw midnight in UTC', async () => {
    global.fetch = jest.fn(async () => tableAResponse('2026-10-22')) as unknown as typeof fetch

    const rates = await new NBPTableAProvider().fetchRates(TEST_DATE, TEST_SCOPE, new Set(['PLN', 'EUR']))

    // 22 Oct 2026 is CEST (UTC+2)
    expect(rates[0].date.toISOString()).toBe('2026-10-21T22:00:00.000Z')
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
