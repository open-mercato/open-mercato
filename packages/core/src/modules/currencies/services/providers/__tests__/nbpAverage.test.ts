import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { fetchWithTimeout } from '@open-mercato/shared/lib/http/fetchWithTimeout'
import { NBPAverageRateProvider, NBP_AVERAGE_PROVIDER_SOURCE } from '../nbpAverage'

jest.mock('@open-mercato/shared/lib/http/fetchWithTimeout', () => ({
  fetchWithTimeout: jest.fn(),
  resolveTimeoutMs: jest.fn(() => 15_000),
}))

const fetchMock = jest.mocked(fetchWithTimeout)
const scope = { tenantId: 'tenant', organizationId: 'organization' }
const date = new Date('2026-08-24T00:00:00.000Z')

function response(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response
}

function table(tableId: 'A' | 'B', rates: Array<{ code: string; mid: number }>) {
  return [{
    table: tableId,
    no: `163/${tableId}/NBP/2026`,
    effectiveDate: '2026-08-24',
    rates: rates.map((rate) => ({ currency: rate.code, ...rate })),
  }]
}

describe('NBPAverageRateProvider', () => {
  beforeEach(() => jest.resetAllMocks())

  it('maps validated A/B publications to official foreign-currency-to-PLN average rates', async () => {
    fetchMock.mockResolvedValueOnce(response(200, table('A', [{ code: 'EUR', mid: 4.2531 }])))
    fetchMock.mockResolvedValueOnce(response(200, table('B', [{ code: 'USD', mid: 3.8912 }])))
    const provider = new NBPAverageRateProvider()

    const rates = await provider.fetchRates(date, scope, new Set(['PLN', 'EUR', 'USD']))

    expect(provider.source).toBe(NBP_AVERAGE_PROVIDER_SOURCE)
    expect(provider.selectionMode).toBe('explicit')
    expect(rates).toEqual([
      expect.objectContaining({
        fromCurrencyCode: 'EUR',
        toCurrencyCode: 'PLN',
        rate: '4.2531',
        type: 'average',
        externalReference: '163/A/NBP/2026',
        date,
      }),
      expect.objectContaining({
        fromCurrencyCode: 'USD',
        toCurrencyCode: 'PLN',
        rate: '3.8912',
        type: 'average',
        externalReference: '163/B/NBP/2026',
        date,
      }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('accepts a missing table as a successful empty contribution', async () => {
    fetchMock.mockResolvedValueOnce(response(404))
    fetchMock.mockResolvedValueOnce(response(200, table('B', [{ code: 'USD', mid: 3.8912 }])))

    const rates = await new NBPAverageRateProvider().fetchRates(date, scope, new Set(['PLN', 'USD']))

    expect(rates).toHaveLength(1)
    expect(rates[0].externalReference).toBe('163/B/NBP/2026')
  })

  it('rejects duplicate A/B currencies before returning any rate', async () => {
    fetchMock.mockResolvedValueOnce(response(200, table('A', [{ code: 'EUR', mid: 4.2531 }])))
    fetchMock.mockResolvedValueOnce(response(200, table('B', [{ code: 'EUR', mid: 4.251 }])) )

    await expect(new NBPAverageRateProvider().fetchRates(date, scope, new Set(['PLN', 'EUR'])))
      .rejects.toThrow('duplicate currency: EUR')
  })

  it('rejects malformed and failed table responses as one provider failure', async () => {
    fetchMock.mockResolvedValueOnce(response(200, table('A', [{ code: 'EUR', mid: 4.2531 }])))
    fetchMock.mockResolvedValueOnce(response(500))

    await expect(new NBPAverageRateProvider().fetchRates(date, scope, new Set(['PLN', 'EUR'])))
      .rejects.toThrow('table B request failed')
  })

  it('rejects a publication number that does not identify the returned table', async () => {
    const invalidTable = table('A', [{ code: 'EUR', mid: 4.2531 }])
    invalidTable[0].no = '163/B/NBP/2026'
    fetchMock.mockResolvedValueOnce(response(200, invalidTable))
    fetchMock.mockResolvedValueOnce(response(404))

    await expect(new NBPAverageRateProvider().fetchRates(date, scope, new Set(['PLN', 'EUR'])))
      .rejects.toThrow('table A publication number is invalid')
  })

  it('rejects an effective date that differs from the requested calendar date', async () => {
    const invalidTable = table('A', [{ code: 'EUR', mid: 4.2531 }])
    invalidTable[0].effectiveDate = '2026-08-23'
    fetchMock.mockResolvedValueOnce(response(200, invalidTable))
    fetchMock.mockResolvedValueOnce(response(404))

    await expect(new NBPAverageRateProvider().fetchRates(date, scope, new Set(['PLN', 'EUR'])))
      .rejects.toThrow('effective date does not match the requested date')
  })

  it('does not call NBP when PLN is not active for the scope', async () => {
    const rates = await new NBPAverageRateProvider().fetchRates(date, scope, new Set(['EUR']))

    expect(rates).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
