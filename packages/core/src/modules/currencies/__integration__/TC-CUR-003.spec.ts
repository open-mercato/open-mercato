import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteCurrenciesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/currenciesFixtures';

/**
 * TC-CUR-003: Currency Fetch Config CRUD via API
 * Covers: POST/GET/DELETE /api/currencies/fetch-configs
 */
test.describe('TC-CUR-003: Currency Fetch Config CRUD via API', () => {
  test('should create, read, and delete a fetch config', async ({ request }) => {
    let token: string | null = null;
    let configId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      const createResponse = await apiRequest(request, 'POST', '/api/currencies/fetch-configs', {
        token,
        data: { provider: 'Custom', isEnabled: false },
      });
      expect(createResponse.status(), 'POST /api/currencies/fetch-configs should return 201').toBe(201);
      const createBody = (await createResponse.json()) as { config?: { id?: string } };
      expect(createBody.config?.id, 'Response should contain config.id').toBeTruthy();
      configId = createBody.config?.id ?? null;

      const getResponse = await apiRequest(request, 'GET', '/api/currencies/fetch-configs', { token });
      expect(getResponse.status(), 'GET /api/currencies/fetch-configs should return 200').toBe(200);
      const getBody = (await getResponse.json()) as { configs?: Array<Record<string, unknown>> };
      expect(Array.isArray(getBody.configs), 'Response should contain configs array').toBeTruthy();
      const found = (getBody.configs ?? []).some((c) => c.id === configId);
      expect(found, 'Created fetch config should appear in the list').toBeTruthy();

      const deleteResponse = await apiRequest(
        request,
        'DELETE',
        `/api/currencies/fetch-configs?id=${encodeURIComponent(configId!)}`,
        { token },
      );
      expect(deleteResponse.status(), 'DELETE /api/currencies/fetch-configs should return 200').toBe(200);
      configId = null;
    } finally {
      await deleteCurrenciesEntityIfExists(request, token, '/api/currencies/fetch-configs', configId);
    }
  });
});
