import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '../helpers/salesFixtures';

/**
 * TC-SALES-007: Shipment Recording
 * Source: .ai/qa/scenarios/TC-SALES-007-shipment-recording.md
 */
test.describe('TC-SALES-007: Shipment Recording', () => {
  test('should create shipment with shipped item', async ({ request }) => {
    let token: string | null = null;
    let orderId: string | null = null;
    let lineId: string | null = null;
    let shipmentId: string | null = null;

    try {
      token = await getAuthToken(request);
      orderId = await createSalesOrderFixture(request, token, 'USD');
      lineId = await createOrderLineFixture(request, token, orderId);

      const shipmentResponse = await apiRequest(request, 'POST', '/api/sales/shipments', {
        token,
        data: {
          orderId,
          currencyCode: 'USD',
          items: [{ orderLineId: lineId, quantity: 1 }],
        },
      });
      expect(shipmentResponse.ok()).toBeTruthy();
      const shipmentBody = (await shipmentResponse.json()) as { id?: string };
      shipmentId = shipmentBody.id ?? null;
      expect(shipmentId).toBeTruthy();
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/shipments', shipmentId);
      await deleteSalesEntityIfExists(request, token, '/api/sales/order-lines', lineId);
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId);
    }
  });
});

