import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import { deleteSalesEntityIfExists } from '../helpers/salesFixtures';

/**
 * TC-SALES-015: Payment Method Config
 * Source: .ai/qa/scenarios/TC-SALES-015-payment-method-config.md
 */
test.describe('TC-SALES-015: Payment Method Config', () => {
  test('should create, update and delete payment method', async ({ request }) => {
    let token: string | null = null;
    let paymentMethodId: string | null = null;
    const code = `qa-pay-${Date.now()}`;

    try {
      token = await getAuthToken(request);

      const createResponse = await apiRequest(request, 'POST', '/api/sales/payment-methods', {
        token,
        data: {
          name: `QA Payment Method ${Date.now()}`,
          code,
        },
      });
      expect(createResponse.ok()).toBeTruthy();
      const createBody = (await createResponse.json()) as { id?: string };
      paymentMethodId = createBody.id ?? null;
      expect(paymentMethodId).toBeTruthy();

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/payment-methods', {
        token,
        data: {
          id: paymentMethodId,
          name: `QA Payment Method Updated ${Date.now()}`,
        },
      });
      expect(updateResponse.ok()).toBeTruthy();
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payment-methods', paymentMethodId);
    }
  });
});

