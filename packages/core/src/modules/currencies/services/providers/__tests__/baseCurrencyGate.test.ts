import { describe, it, expect, jest, afterEach } from '@jest/globals'
import { NBPProvider } from '../nbp'
import { RaiffeisenPolandProvider } from '../raiffeisen'

/**
 * Both bundled providers quote everything against PLN, so each bails out of the whole fetch when
 * PLN is missing from the currency set `RateFetchingService` hands them. That is why the set must
 * not be narrowed by selectability: a deactivated PLN used to silence the entire provider, not
 * just PLN's own pairs. These tests pin the gate itself; the service-side half — an inactive PLN
 * staying in the set — lives in `rateFetchingService.basic.test.ts`.
 */
const TEST_DATE = new Date('2024-01-15T00:00:00.000Z')
const TEST_SCOPE = { tenantId: 'test-tenant', organizationId: 'test-org' }

describe('provider base-currency gate', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  const providers = [
    { name: 'NBP', create: () => new NBPProvider() },
    { name: 'Raiffeisen Bank Polska', create: () => new RaiffeisenPolandProvider() },
  ]

  for (const { name, create } of providers) {
    it(`${name} returns no rates and issues no request when PLN is absent from the set`, async () => {
      const fetchMock = jest.fn()
      global.fetch = fetchMock as unknown as typeof fetch

      const provider = create()
      const rates = await provider.fetchRates(TEST_DATE, TEST_SCOPE, new Set(['USD', 'EUR']))

      expect(rates).toEqual([])
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it(`${name} declares PLN as the base currency the gate checks`, () => {
      expect(create().providerBaseCurrency).toBe('PLN')
    })
  }
})
