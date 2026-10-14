import { describe, it, expect, afterEach } from '@jest/globals'
import { NBPProvider } from '../nbp'
import { RaiffeisenPolandProvider } from '../raiffeisen'
import { invertProviderRate, toProviderRate } from '../base'

const TEST_DATE = new Date('2024-01-15T00:00:00.000Z')
const TEST_SCOPE = { tenantId: 'test-tenant', organizationId: 'test-org' }

function mockJsonResponse(body: unknown) {
  global.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch
}

describe('provider rate validation', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('normalizes and inverts usable rates exactly', () => {
    expect(toProviderRate('4.3215')).toBe('4.3215')
    expect(invertProviderRate('4')).toBe('0.25')
    expect(toProviderRate('0')).toBeNull()
    expect(invertProviderRate('abc')).toBeNull()
    expect(invertProviderRate(0)).toBeNull()
  })

  it('Raiffeisen skips one unusable sell rate and keeps the rest of the day', async () => {
    mockJsonResponse({
      date: '2024-01-15',
      rates: {
        '08:00': [
          { code: 'EUR', units: 1, buy: '4.30', sell: '4.50', spread: '0.2', date: '2024-01-15', time: '08:00' },
          { code: 'USD', units: 1, buy: '3.90', sell: '0', spread: '0', date: '2024-01-15', time: '08:00' },
        ],
      },
      range: { minRateDate: '2024-01-01', maxRateDate: '2024-01-15' },
    })

    const rates = await new RaiffeisenPolandProvider().fetchRates(TEST_DATE, TEST_SCOPE, new Set(['PLN', 'EUR', 'USD']))

    expect(rates.map((rate) => `${rate.fromCurrencyCode}/${rate.toCurrencyCode}`)).toEqual(['PLN/EUR', 'EUR/PLN'])
  })

  it('NBP skips one unusable ask rate and keeps the rest of the table', async () => {
    mockJsonResponse([
      {
        table: 'C',
        no: '010/C/NBP/2024',
        tradingDate: '2024-01-12',
        effectiveDate: '2024-01-15',
        rates: [
          { currency: 'euro', code: 'EUR', bid: 4.3, ask: 4.4 },
          { currency: 'dolar', code: 'USD', bid: 3.9, ask: 0 },
        ],
      },
    ])

    const rates = await new NBPProvider().fetchRates(TEST_DATE, TEST_SCOPE, new Set(['PLN', 'EUR', 'USD']))

    expect(rates.map((rate) => `${rate.fromCurrencyCode}/${rate.toCurrencyCode}`)).toEqual(['PLN/EUR', 'EUR/PLN'])
    expect(rates[0]?.metadata).toMatchObject({ tableNo: '010/C/NBP/2024' })
  })
})
