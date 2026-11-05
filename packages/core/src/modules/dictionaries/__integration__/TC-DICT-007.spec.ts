import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-DICT-007: Protected currency dictionary cannot be modified or deleted
 *
 * The `currency` dictionary is seeded as system reference data during tenant
 * initialization (customers module `seedDefaults` -> seedCurrencyDictionary).
 * The dictionaries routes guard it via `isProtectedCurrencyDictionary` (key
 * 'currency' or 'currencies') and return 400
 * `{ error: 'The currency dictionary cannot be modified or deleted.' }` for a key
 * change, a deactivation (isActive:false), or a delete.
 *
 * This test reads the seeded dictionary and asserts the protection holds; it
 * creates no fixtures and (correctly) cannot delete the protected record, so no
 * teardown is required. Gated to run only when the `customers` module (which
 * seeds the currency dictionary) is enabled — see TC-DICT-007.meta.ts.
 */
type DictionaryListItem = { id?: string; key?: string; isActive?: boolean };

test.describe('TC-DICT-007: Protected currency dictionary', () => {
  test('currency dictionary rejects key change, deactivation, and delete with 400 and stays intact', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');

    const listResponse = await apiRequest(request, 'GET', '/api/dictionaries', { token });
    expect(listResponse.status(), 'GET /api/dictionaries should return 200').toBe(200);
    const items = (await readJsonSafe<{ items?: DictionaryListItem[] }>(listResponse))?.items ?? [];

    const currency = items.find(
      (item) => item.key === 'currency' || item.key === 'currencies',
    );
    expect(
      currency?.id,
      'A seeded currency dictionary (key "currency"/"currencies") must be present',
    ).toBeTruthy();
    const currencyId = currency!.id as string;
    expect(currency?.isActive, 'Seeded currency dictionary should be active').toBe(true);

    // PATCH isActive:false -> 400 (protected).
    const deactivate = await apiRequest(
      request,
      'PATCH',
      `/api/dictionaries/${encodeURIComponent(currencyId)}`,
      { token, data: { isActive: false } },
    );
    expect(deactivate.status(), 'PATCH isActive:false on currency should return 400').toBe(400);

    // PATCH key change -> 400 (protected).
    const rename = await apiRequest(
      request,
      'PATCH',
      `/api/dictionaries/${encodeURIComponent(currencyId)}`,
      { token, data: { key: `currency_codes_${Date.now()}` } },
    );
    expect(rename.status(), 'PATCH key change on currency should return 400').toBe(400);

    // DELETE -> 400 (protected).
    const remove = await apiRequest(
      request,
      'DELETE',
      `/api/dictionaries/${encodeURIComponent(currencyId)}`,
      { token },
    );
    expect(remove.status(), 'DELETE on currency should return 400').toBe(400);

    // Currency dictionary remains present and active after the blocked attempts.
    const afterResponse = await apiRequest(request, 'GET', '/api/dictionaries', { token });
    expect(afterResponse.status(), 'GET /api/dictionaries (after) should return 200').toBe(200);
    const afterItems = (await readJsonSafe<{ items?: DictionaryListItem[] }>(afterResponse))?.items ?? [];
    const currencyAfter = afterItems.find((item) => item.id === currencyId);
    expect(currencyAfter, 'Currency dictionary should still exist after blocked attempts').toBeTruthy();
    expect(currencyAfter?.isActive, 'Currency dictionary should remain active').toBe(true);
  });
});
