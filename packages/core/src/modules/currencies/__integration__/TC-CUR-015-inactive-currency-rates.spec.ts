import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures';

/**
 * TC-CUR-015: A deactivated currency still receives exchange rates.
 * Covers the fix to `RateFetchingService.getExistingCurrencies()`, which filtered the currency
 * set by `isActive: true`. Because a provider rate is kept only when **both** legs of its pair
 * are in that set, deactivating a currency stopped writing any rate for it — and records still
 * denominated in it became unconvertible once the stored rates aged past the consumer's lookback
 * window (60 days for `customers/api/deals/{aggregate,summary}`), with no error surfaced.
 *
 * Runs against `example_fixed_rates`, the offline provider the example module registers, so the
 * assertion is deterministic: it emits exactly USD→EUR and EUR→USD, each filtered against the
 * currency set. With one leg deactivated, `totalFetched` is 2 after the fix and 0 before it.
 *
 * The fetch date is randomised into a far-future window because `storeRates` keys on
 * (from, to, date, source) and would otherwise update the previous run's rows, which the
 * teardown has already soft/hard-deleted.
 */
export const integrationMeta = {
  dependsOnModules: ['currencies', 'example'],
};

const PROVIDER_SOURCE = 'example_fixed_rates';
const PAIR_CODES = ['USD', 'EUR'] as const;

type CurrencyRow = { id: string; code: string; isActive: boolean; isBase: boolean };
type ExchangeRateRow = { id: string; fromCurrencyCode: string; toCurrencyCode: string; date: string; source: string };

async function findCurrencyByCode(
  request: APIRequestContext,
  token: string,
  code: string,
): Promise<CurrencyRow | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/currencies/currencies?code=${encodeURIComponent(code)}&pageSize=100`,
    { token },
  );
  expect(response.status(), `GET currencies?code=${code} should return 200`).toBe(200);
  const body = await readJsonSafe<{ items?: CurrencyRow[] }>(response);
  return (body?.items ?? []).find((item) => item.code === code) ?? null;
}

async function listProviderRates(
  request: APIRequestContext,
  token: string,
  fetchDate: string,
): Promise<ExchangeRateRow[]> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/currencies/exchange-rates?source=${encodeURIComponent(PROVIDER_SOURCE)}&pageSize=100`,
    { token },
  );
  expect(response.status(), 'GET exchange-rates should return 200').toBe(200);
  const body = await readJsonSafe<{ items?: ExchangeRateRow[] }>(response);
  return (body?.items ?? []).filter((item) => item.date === fetchDate);
}

test.describe('TC-CUR-015: rate fetching ignores the isActive flag', () => {
  test('a deactivated currency still gets rates stored for both legs of its pair', async ({ request }) => {
    const fetchDate = new Date(
      Date.UTC(2092, 0, 1) + Number.parseInt(randomUUID().slice(0, 8), 16),
    ).toISOString();

    let token: string | null = null;
    let deactivatedId: string | null = null;
    let originalIsActive = true;
    const createdCurrencyIds: string[] = [];

    try {
      token = await getAuthToken(request, 'admin');

      // The provider only quotes USD/EUR, so both must exist. Create whichever is missing
      // rather than assuming the demo seed ran.
      const pair: CurrencyRow[] = [];
      for (const code of PAIR_CODES) {
        const existing = await findCurrencyByCode(request, token, code);
        if (existing) {
          pair.push(existing);
          continue;
        }
        const id = await createCurrencyFixture(request, token, { code, name: `QA TC-CUR-015 ${code}` });
        createdCurrencyIds.push(id);
        const created = await findCurrencyByCode(request, token, code);
        expect(created, `currency ${code} should be readable after creation`).not.toBeNull();
        pair.push(created as CurrencyRow);
      }

      // Deactivating the base currency would change conversion behaviour for every other
      // spec sharing this database, so target the non-base leg.
      const target = pair.find((currency) => !currency.isBase);
      expect(target, 'at least one leg of USD/EUR should be a non-base currency').toBeTruthy();
      deactivatedId = (target as CurrencyRow).id;
      originalIsActive = (target as CurrencyRow).isActive;

      const deactivate = await apiRequest(request, 'PUT', '/api/currencies/currencies', {
        token,
        data: { id: deactivatedId, isActive: false },
      });
      expect(deactivate.status(), 'PUT isActive=false should return 200').toBe(200);

      const deactivated = await findCurrencyByCode(request, token, (target as CurrencyRow).code);
      expect(deactivated?.isActive, 'the target currency is inactive before the fetch').toBe(false);

      const fetchResponse = await apiRequest(request, 'POST', '/api/currencies/fetch-rates', {
        token,
        data: { date: fetchDate, providers: [PROVIDER_SOURCE] },
      });
      expect(fetchResponse.status(), 'POST /api/currencies/fetch-rates should return 200').toBe(200);

      // Both provider pairs have the deactivated currency on one leg. Before the fix the
      // currency set excluded it, every pair was filtered out and this was 0.
      expect(await readJsonSafe<Record<string, unknown>>(fetchResponse)).toMatchObject({
        totalFetched: 2,
        byProvider: { [PROVIDER_SOURCE]: { count: 2 } },
        errors: [],
      });

      const storedRates = await listProviderRates(request, token, fetchDate);
      expect(
        storedRates.map((rate) => `${rate.fromCurrencyCode}->${rate.toCurrencyCode}`).sort(),
        'both legs of the pair are stored despite one currency being inactive',
      ).toEqual(['EUR->USD', 'USD->EUR']);

      // The stored rows are what keeps records denominated in the deactivated currency
      // convertible, so assert the deactivated code really appears on both sides.
      const deactivatedCode = (target as CurrencyRow).code;
      expect(
        storedRates.filter((rate) => rate.fromCurrencyCode === deactivatedCode),
        `a rate out of the deactivated ${deactivatedCode} is stored`,
      ).toHaveLength(1);
      expect(
        storedRates.filter((rate) => rate.toCurrencyCode === deactivatedCode),
        `a rate into the deactivated ${deactivatedCode} is stored`,
      ).toHaveLength(1);
    } finally {
      if (token && deactivatedId) {
        await apiRequest(request, 'PUT', '/api/currencies/currencies', {
          token,
          data: { id: deactivatedId, isActive: originalIsActive },
        }).catch(() => {});
      }
      // Rates are dropped first: `deleteCurrencyCommand` refuses a currency that still has
      // active exchange rates, which is exactly what this test just created.
      await withClient(async (client) => {
        await client.query('DELETE FROM exchange_rates WHERE source = $1 AND date = $2', [
          PROVIDER_SOURCE,
          fetchDate,
        ]);
      }).catch(() => {});
      for (const currencyId of createdCurrencyIds) {
        await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId);
      }
    }
  });
});
