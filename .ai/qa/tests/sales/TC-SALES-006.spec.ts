import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '../helpers/salesFixtures';

/**
 * TC-SALES-006: Order Tax Calculation
 * Source: .ai/qa/scenarios/TC-SALES-006-order-tax-calculation.md
 */
test.describe('TC-SALES-006: Order Tax Calculation', () => {
  test('should persist tax fields on order line', async ({ request }) => {
    let token: string | null = null;
    let orderId: string | null = null;
    let lineId: string | null = null;

    try {
      token = await getAuthToken(request);
      orderId = await createSalesOrderFixture(request, token, 'USD');
      lineId = await createOrderLineFixture(request, token, orderId, {
        quantity: 2,
        unitPriceNet: 100,
        unitPriceGross: 123,
        taxRate: 23,
        taxAmount: 23,
      });

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/order-lines?orderId=${encodeURIComponent(orderId)}`,
        { token },
      );
      expect(listResponse.ok()).toBeTruthy();
      const listBody = (await listResponse.json()) as {
        items?: Array<{ id?: string; tax_rate?: string; tax_amount?: string }>;
      };
      const created = listBody.items?.find((item) => item.id === lineId);
      expect(created).toBeTruthy();
      expect(created?.tax_rate).toBe('23.0000');
      expect(created?.tax_amount).toBe('23.0000');
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/order-lines', lineId);
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId);
    }
  });
});
