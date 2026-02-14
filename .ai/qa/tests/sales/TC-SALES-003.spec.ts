import { expect, test } from '@playwright/test';
import { getAuthToken } from '../helpers/api';
import { createSalesOrderFixture, deleteSalesEntityIfExists } from '../helpers/salesFixtures';

/**
 * TC-SALES-003: Order Creation
 * Source: .ai/qa/scenarios/TC-SALES-003-order-creation.md
 */
test.describe('TC-SALES-003: Order Creation', () => {
  test('should create and delete a sales order', async ({ request }) => {
    let token: string | null = null;
    let orderId: string | null = null;

    try {
      token = await getAuthToken(request);
      orderId = await createSalesOrderFixture(request, token, 'USD');
      expect(orderId).toBeTruthy();
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId);
    }
  });
});

