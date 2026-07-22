import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createFetchConfigFixture,
  deleteCurrenciesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures';

/**
 * TC-CUR-008: Fetch-rates endpoint — POST /api/currencies/fetch-rates returns the
 * provider result envelope and records the side effect on the matching config.
 * Source: issue #2490 (currencies integration coverage).
 *
 * Only the NBP and Raiffeisen providers are registered in DI; `Custom` is a valid
 * config provider but has no fetcher. Posting `providers: ['Custom']` therefore
 * runs no network call and returns 200 with `{ totalFetched: 0, byProvider: {},
 * errors: ['Unknown provider: Custom'] }`, while the fetch-rates route still
 * stamps `lastSyncAt`/`lastSyncCount` on the existing `Custom` config — the
 * deterministic side effect this test asserts.
 */
type FetchConfig = {
  id?: string;
  provider?: string;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncCount?: number | null;
};

async function findCustomConfig(
  request: APIRequestContext,
  token: string,
): Promise<FetchConfig | null> {
  const response = await apiRequest(request, 'GET', '/api/currencies/fetch-configs', { token });
  const body = await readJsonSafe<{ configs?: FetchConfig[] }>(response);
  return (body?.configs ?? []).find((config) => config.provider === 'Custom') ?? null;
}

test.describe('TC-CUR-008: fetch-rates endpoint', () => {
  test('triggers provider sync and updates the Custom config sync metadata', async ({ request }) => {
    let token: string | null = null;
    let configId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      // Defensive pre-clean: the (org, tenant, provider) uniqueness constraint
      // means a leftover Custom config (e.g. from a crashed run or a retry) would
      // make the fixture create fail with 409/400.
      const existingCustom = await findCustomConfig(request, token);
      if (existingCustom?.id) {
        await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/fetch-configs', existingCustom.id);
      }

      configId = await createFetchConfigFixture(request, token, { provider: 'Custom', isEnabled: false });

      const fetchResponse = await apiRequest(request, 'POST', '/api/currencies/fetch-rates', {
        token,
        data: { providers: ['Custom'] },
      });
      expect(fetchResponse.status(), 'POST /api/currencies/fetch-rates should return 200').toBe(200);

      const result = await readJsonSafe<{
        totalFetched?: number;
        byProvider?: Record<string, unknown>;
        errors?: unknown[];
      }>(fetchResponse);
      expect(typeof result?.totalFetched, 'response should include numeric totalFetched').toBe('number');
      expect(result?.byProvider && typeof result.byProvider === 'object', 'response should include a byProvider map').toBeTruthy();
      expect(Array.isArray(result?.errors), 'response should include an errors array').toBeTruthy();
      expect(result?.totalFetched, 'no rates are fetched for the unregistered Custom provider').toBe(0);
      expect(
        (result?.errors ?? []).some((entry) => typeof entry === 'string' && entry.includes('Custom')),
        'errors should report the unregistered Custom provider',
      ).toBeTruthy();

      const updatedConfig = await findCustomConfig(request, token);
      expect(updatedConfig?.id, 'Custom config should still exist after fetch').toBe(configId);
      expect(updatedConfig?.lastSyncAt, 'fetch-rates should stamp lastSyncAt on the Custom config').toBeTruthy();
      expect(updatedConfig?.lastSyncCount, 'lastSyncCount should reflect zero fetched rates').toBe(0);
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/fetch-configs', configId);
    }
  });
});
