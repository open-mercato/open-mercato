import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createRandomCurrencyFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-011: Currency active flag and soft delete.
 * Source: issue #2490 (currencies integration coverage).
 *
 * Verified against the route's actual behavior (the list applies no implicit
 * `isActive` filter — only `deletedAt: null`):
 *   - `?isActive=true` hides an inactive currency; `?isActive=false` reveals it.
 *   - the default (unfiltered) list still includes inactive currencies; only the
 *     explicit active filter excludes them.
 *   - DELETE soft-deletes (sets `deletedAt`), after which the row is absent from
 *     every list view, including the inactive filter.
 * All lookups are scoped by `?id=` so seeded/other-test currencies can't interfere.
 */
async function listById(
  request: APIRequestContext,
  token: string,
  currencyId: string,
  extra = '',
): Promise<Array<{ id: string; isActive: boolean }>> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/currencies/currencies?id=${encodeURIComponent(currencyId)}${extra}`,
    { token },
  );
  expect(response.status(), `GET ?id=${currencyId}${extra} should return 200`).toBe(200);
  const body = await readJsonSafe<{ items?: Array<{ id: string; isActive: boolean }> }>(response);
  return body?.items ?? [];
}

test.describe('TC-CUR-011: currency active flag and soft delete', () => {
  test('isActive filtering and DELETE soft-delete behave as the route defines', async ({ request }) => {
    let token: string | null = null;
    let currencyId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      currencyId = (await createRandomCurrencyFixture(request, token, { name: 'QA TC-CUR-011 Currency' })).id;

      const initial = await listById(request, token, currencyId);
      expect(initial.map((item) => item.id), 'new currency appears in the default list').toContain(currencyId);
      expect(initial[0]?.isActive, 'new currency defaults to active').toBe(true);

      const deactivate = await apiRequest(request, 'PUT', '/api/currencies/currencies', {
        token,
        data: { id: currencyId, isActive: false },
      });
      expect(deactivate.status(), 'PUT isActive=false should return 200').toBe(200);

      const activeFiltered = await listById(request, token, currencyId, '&isActive=true');
      expect(activeFiltered, 'isActive=true filter hides the deactivated currency').toHaveLength(0);

      const inactiveFiltered = await listById(request, token, currencyId, '&isActive=false');
      expect(inactiveFiltered.map((item) => item.id), 'isActive=false filter reveals the deactivated currency').toContain(currencyId);

      const defaultAfterDeactivate = await listById(request, token, currencyId);
      expect(
        defaultAfterDeactivate.map((item) => item.id),
        'default list still includes inactive currencies (only deletedAt excludes)',
      ).toContain(currencyId);

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/currencies/currencies?id=${encodeURIComponent(currencyId)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE should return 200').toBe(200);

      const inactiveAfterDelete = await listById(request, token, currencyId, '&isActive=false');
      expect(inactiveAfterDelete, 'soft-deleted currency is gone from the inactive filter').toHaveLength(0);

      const defaultAfterDelete = await listById(request, token, currencyId);
      expect(defaultAfterDelete, 'soft-deleted currency is gone from the default list').toHaveLength(0);
      currencyId = null;
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/currencies', currencyId);
    }
  });
});
