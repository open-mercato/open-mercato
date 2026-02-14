import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '../helpers/salesFixtures';

/**
 * TC-SALES-010: Payment Recording
 * Source: .ai/qa/scenarios/TC-SALES-010-payment-recording.md
 */
test.describe('TC-SALES-010: Payment Recording', () => {
  test('should create payment for order', async ({ request }) => {
    let token: string | null = null;
    let orderId: string | null = null;
    let paymentId: string | null = null;

    try {
      token = await getAuthToken(request);
      orderId = await createSalesOrderFixture(request, token, 'USD');

      const paymentResponse = await apiRequest(request, 'POST', '/api/sales/payments', {
        token,
        data: {
          orderId,
          amount: 42,
          currencyCode: 'USD',
        },
      });
      expect(paymentResponse.ok()).toBeTruthy();
      const paymentBody = (await paymentResponse.json()) as { id?: string };
      paymentId = paymentBody.id ?? null;
      expect(paymentId).toBeTruthy();
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/payments', paymentId);
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId);
    }
  });
});

