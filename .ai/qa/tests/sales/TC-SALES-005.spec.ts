import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '../helpers/salesFixtures';

/**
 * TC-SALES-005: Order Discount Adjustment
 * Source: .ai/qa/scenarios/TC-SALES-005-order-discount-adjustment.md
 */
test.describe('TC-SALES-005: Order Discount Adjustment', () => {
  test('should create, update and delete order adjustment', async ({ request }) => {
    let token: string | null = null;
    let orderId: string | null = null;
    let adjustmentId: string | null = null;

    try {
      token = await getAuthToken(request);
      orderId = await createSalesOrderFixture(request, token, 'USD');

      const createResponse = await apiRequest(request, 'POST', '/api/sales/order-adjustments', {
        token,
        data: {
          orderId,
          scope: 'order',
          kind: 'discount',
          label: 'QA Discount',
          currencyCode: 'USD',
          amountNet: 5,
          amountGross: 5,
        },
      });
      expect(createResponse.ok()).toBeTruthy();
      const createBody = (await createResponse.json()) as { id?: string };
      adjustmentId = createBody.id ?? null;
      expect(adjustmentId).toBeTruthy();

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/order-adjustments', {
        token,
        data: {
          id: adjustmentId,
          orderId,
          scope: 'order',
          kind: 'discount',
          label: 'QA Discount Updated',
          currencyCode: 'USD',
          amountNet: 7,
          amountGross: 7,
        },
      });
      expect(updateResponse.ok()).toBeTruthy();

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/sales/order-adjustments', {
        token,
        data: { id: adjustmentId, orderId },
      });
      expect(deleteResponse.ok()).toBeTruthy();
      adjustmentId = null;
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/order-adjustments', adjustmentId);
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId);
    }
  });
});

