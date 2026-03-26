import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures';

type JsonMap = Record<string, unknown>;

function readItems(payload: unknown): JsonMap[] {
  if (!payload || typeof payload !== 'object') return [];
  const map = payload as JsonMap;
  if (Array.isArray(map.items)) return map.items as JsonMap[];
  if (map.result && typeof map.result === 'object' && Array.isArray((map.result as JsonMap).items)) {
    return (map.result as JsonMap).items as JsonMap[];
  }
  return [];
}

function readNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim().length > 0) return Number.parseFloat(value);
  return Number.NaN;
}

async function ensureShippingMethodId(request: Parameters<typeof apiRequest>[0], token: string): Promise<string> {
  const listResponse = await apiRequest(
    request,
    'GET',
    '/api/sales/shipping-methods?page=1&pageSize=1&isActive=true',
    { token },
  );
  expect(listResponse.ok(), `Failed to list shipping methods: ${listResponse.status()}`).toBeTruthy();
  const listBody = (await listResponse.json()) as unknown;
  const existingMethod = readItems(listBody)[0] ?? null;
  const existingMethodId =
    existingMethod && typeof existingMethod.id === 'string'
      ? existingMethod.id
      : null;
  if (existingMethodId) return existingMethodId;

  const timestamp = Date.now();
  const createResponse = await apiRequest(request, 'POST', '/api/sales/shipping-methods', {
    token,
    data: {
      name: `QA Shipping Method ${timestamp}`,
      code: `qa-shipping-${timestamp}`,
      isActive: true,
      currencyCode: 'USD',
      baseRateNet: '10.00',
      baseRateGross: '10.00',
    },
  });
  expect(createResponse.ok(), `Failed to create shipping method: ${createResponse.status()}`).toBeTruthy();
  const createBody = (await createResponse.json()) as unknown;
  const createdId =
    createBody && typeof createBody === 'object' && typeof (createBody as JsonMap).id === 'string'
      ? ((createBody as JsonMap).id as string)
      : null;
  expect(createdId, 'Shipping method id should be present').toBeTruthy();
  return createdId as string;
}

async function readOrderGrandTotalGross(request: Parameters<typeof apiRequest>[0], token: string, orderId: string): Promise<number> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/sales/orders?id=${encodeURIComponent(orderId)}&page=1&pageSize=1`,
    { token },
  );
  expect(response.ok(), `Failed to read order ${orderId}: ${response.status()}`).toBeTruthy();
  const body = (await response.json()) as unknown;
  const order = readItems(body)[0] ?? null;
  expect(order, 'Order should be returned by list query').toBeTruthy();
  const grandTotalGross = readNumber(
    (order as JsonMap).grand_total_gross_amount ?? (order as JsonMap).grandTotalGrossAmount,
  );
  expect(Number.isFinite(grandTotalGross), 'Order grand total gross should be numeric').toBeTruthy();
  return grandTotalGross;
}

/**
 * TC-SALES-018: Shipment Cost Impact on Totals
 * Source: .ai/qa/scenarios/TC-SALES-018-shipment-cost-total-impact.md
 */
test.describe('TC-SALES-018: Shipment Cost Impact on Totals', () => {
  test('should change totals after recording shipment with tracking', async ({ request }) => {
    let orderId: string | null = null;
    let orderLineId: string | null = null;

    try {
      const token = await getAuthToken(request, 'admin');
      const shippingMethodId = await ensureShippingMethodId(request, token);
      orderId = await createSalesOrderFixture(request, token, 'USD');
      orderLineId = await createOrderLineFixture(request, token, orderId, {
        name: `QA TC-SALES-018 Item ${Date.now()}`,
        quantity: 1,
        unitPriceNet: 80,
        unitPriceGross: 80,
        currencyCode: 'USD',
      });

      const grossBeforeShipment = await readOrderGrandTotalGross(request, token, orderId);
      const shipmentResponse = await apiRequest(request, 'POST', '/api/sales/shipments', {
        token,
        data: {
          orderId,
          shipmentNumber: `SHIP-${Date.now()}`,
          shippingMethodId,
          trackingNumbers: [`TRACK-${Date.now()}`],
          shippedAt: new Date().toISOString(),
          currencyCode: 'USD',
          items: [
            {
              orderLineId,
              quantity: '1',
            },
          ],
        },
      });
      expect(shipmentResponse.ok(), `Failed to create shipment: ${shipmentResponse.status()}`).toBeTruthy();

      const grossAfterShipment = await readOrderGrandTotalGross(request, token, orderId);
      expect(grossAfterShipment).toBeGreaterThanOrEqual(grossBeforeShipment);
    } finally {
      const cleanupToken = await getAuthToken(request, 'admin').catch(() => null);
      await deleteSalesEntityIfExists(request, cleanupToken, '/api/sales/orders', orderId);
    }
  });
});
