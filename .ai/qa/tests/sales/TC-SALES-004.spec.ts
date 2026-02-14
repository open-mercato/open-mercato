import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '../helpers/salesFixtures';

/**
 * TC-SALES-004: Order Line Management
 * Source: .ai/qa/scenarios/TC-SALES-004-order-line-management.md
 */
test.describe('TC-SALES-004: Order Line Management', () => {
  test('should create, update and delete order line', async ({ request }) => {
    let token: string | null = null;
    let orderId: string | null = null;
    let lineId: string | null = null;

    try {
      token = await getAuthToken(request);
      orderId = await createSalesOrderFixture(request, token, 'USD');
      lineId = await createOrderLineFixture(request, token, orderId);

      const updateResponse = await apiRequest(request, 'PUT', '/api/sales/order-lines', {
        token,
        data: {
          id: lineId,
          orderId,
          currencyCode: 'USD',
          quantity: 5,
          name: `QA line updated ${Date.now()}`,
          unitPriceNet: 11,
          unitPriceGross: 13,
        },
      });
      expect(updateResponse.ok()).toBeTruthy();

      const deleteResponse = await apiRequest(request, 'DELETE', '/api/sales/order-lines', {
        token,
        data: { id: lineId, orderId },
      });
      expect(deleteResponse.ok()).toBeTruthy();
      lineId = null;
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/order-lines', lineId);
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId);
    }
  });
});

