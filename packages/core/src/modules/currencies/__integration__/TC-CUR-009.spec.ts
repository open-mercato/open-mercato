import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-009: Currency options endpoint — search, limit, and inactive handling.
 * Source: issue #2490 (currencies integration coverage).
 *
 * GET /api/currencies/currencies/options returns `{ items: [{ value, label }] }`
 * where `value` is the currency code and `label` is `"<code> - <name>"`. It
 * supports `q`/`query`/`search` (code or name, ilike), `limit` (default 50,
 * max 100), and `includeInactive` (defaults to active-only). Fixture currencies
 * share a unique name stamp so name searches resolve to exactly this test's data
 * (the org also carries seeded currencies).
 */
type OptionItem = { value: string; label: string };

async function fetchOptions(
  request: APIRequestContext,
  token: string,
  query: string,
): Promise<OptionItem[]> {
  const response = await apiRequest(request, 'GET', `/api/currencies/currencies/options${query}`, { token });
  expect(response.status(), `GET options${query} should return 200`).toBe(200);
  const body = await readJsonSafe<{ items?: OptionItem[] }>(response);
  return body?.items ?? [];
}

test.describe('TC-CUR-009: currency options endpoint', () => {
  test('filters options by search term and limit and honors includeInactive', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    const nameToken = `qatc009-${stamp}`;

    let token: string | null = null;
    const createdIds: string[] = [];
    const activeCodes: string[] = [];
    let inactiveCode: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      for (let index = 0; index < 5; index += 1) {
        const currency = await createRandomCurrencyFixture(request, token, { name: `${nameToken} active ${index}` });
        activeCodes.push(currency.code);
        createdIds.push(currency.id);
      }

      const inactiveCurrency = await createRandomCurrencyFixture(request, token, { name: `${nameToken} inactive`, isActive: false });
      inactiveCode = inactiveCurrency.code;
      createdIds.push(inactiveCurrency.id);

      const byName = await fetchOptions(request, token, `?search=${encodeURIComponent(nameToken)}`);
      const byNameValues = byName.map((item) => item.value);
      for (const code of activeCodes) {
        expect(byNameValues, `options (name search) should include active code ${code}`).toContain(code);
      }
      expect(byNameValues, 'inactive currency must be excluded by default').not.toContain(inactiveCode);
      expect(
        byName.every((item) => typeof item.value === 'string' && typeof item.label === 'string' && item.label.includes(' - ')),
        'each option should expose value and "<code> - <name>" label',
      ).toBeTruthy();

      const byCode = await fetchOptions(request, token, `?q=${encodeURIComponent(activeCodes[0])}`);
      expect(byCode.map((item) => item.value), 'options (code search) should include the searched code').toContain(activeCodes[0]);

      const limited = await fetchOptions(request, token, `?search=${encodeURIComponent(nameToken)}&limit=2`);
      expect(limited.length, 'limit=2 should cap the result count').toBeLessThanOrEqual(2);

      const withInactive = await fetchOptions(request, token, `?search=${encodeURIComponent(nameToken)}&includeInactive=true`);
      const withInactiveValues = withInactive.map((item) => item.value);
      expect(withInactiveValues, 'includeInactive=true should include the inactive currency').toContain(inactiveCode);
      for (const code of activeCodes) {
        expect(withInactiveValues, `includeInactive=true should still include active code ${code}`).toContain(code);
      }
    } finally {
      for (const id of createdIds) {
        await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', id);
      }
    }
  });
});
