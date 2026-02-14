import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import { deleteSalesEntityIfExists } from '../helpers/salesFixtures';

/**
 * TC-SALES-014: Shipping Method Config
 * Source: .ai/qa/scenarios/TC-SALES-014-shipping-method-config.md
 */
test.describe('TC-SALES-014: Shipping Method Config', () => {
  test('should create, update and delete shipping method', async ({ request }) => {
    let token: string | null = null;
    let shippingMethodId: string | null = null;
    const code = `qa-ship-${Date.now()}`;

    try {
      token = await getAuthToken(request);

      const createResponse = await apiRequest(request, 'POST', '/api/sales/shipping-methods', {
        token,
        data: {
          name: `QA Shipping ${Date.now()}`,
          code,
        },
      });
      expect(createResponse.ok()).toBeTruthy();
      const createBody = (await createResponse.json()) as { id?: string };
      shippingMethodId = createBody.id ?? null;
      expect(shippingMethodId).toBeTruthy();

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/shipping-methods', {
        token,
        data: {
          id: shippingMethodId,
          name: `QA Shipping Updated ${Date.now()}`,
        },
      });
      expect(updateResponse.ok()).toBeTruthy();
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/shipping-methods', shippingMethodId);
    }
  });
});

