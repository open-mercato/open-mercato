import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  buildMockInboundUrl,
  createWebhookFixture,
  deleteWebhookIfExists,
  getDeliveryDetail,
  listWebhookDeliveries,
  waitForDeliveryStatus,
} from './helpers/fixtures';

test.describe('TC-WEBHOOK-002: Webhook delivery lifecycle', () => {
  test('should deliver a synchronous test webhook and expose the delivery through canonical and aliased routes', async ({ request }) => {
    const token = await getAuthToken(request);
    let webhookId: string | null = null;

    try {
      const created = await createWebhookFixture(request, token, {
        name: `Webhook Delivery ${Date.now()}`,
        url: buildMockInboundUrl(),
        subscribedEvents: ['catalog.product.created'],
        customHeaders: {
          'x-mock-webhook-signature': 'valid',
        },
      });
      webhookId = created.id;

      const testResponse = await apiRequest(request, 'POST', `/api/webhooks/${created.id}/test`, {
        token,
        data: {
          eventType: 'catalog.product.created',
          payload: {
            type: 'catalog.product.created',
            timestamp: new Date().toISOString(),
            data: {
              sku: `SKU-${Date.now()}`,
            },
          },
        },
      });
      expect(testResponse.status()).toBe(200);
      const testBody = await readJsonSafe<{ success: boolean; delivery: { id: string; status: string; responseStatus: number | null; responseBody: string | null; responseHeaders: Record<string, string> | null } }>(testResponse);
      expect(testBody?.success).toBe(true);
      expect(testBody?.delivery.status).toBe('delivered');
      expect(testBody?.delivery.responseStatus).toBe(200);
      expect(testBody?.delivery.responseBody).toBe(JSON.stringify({ ok: true }));
      expect(testBody?.delivery.responseHeaders?.['content-type']).toContain('application/json');

      const deliveryId = testBody?.delivery.id;
      expect(typeof deliveryId).toBe('string');

      const canonicalList = await listWebhookDeliveries(request, token, created.id);
      expect(canonicalList.items.some((item) => item.id === deliveryId)).toBe(true);

      const aliasedList = await listWebhookDeliveries(
        request,
        token,
        created.id,
        `/api/webhooks/webhook-deliveries?webhookId=${encodeURIComponent(created.id)}`,
      );
      expect(aliasedList.items.some((item) => item.id === deliveryId)).toBe(true);

      const canonicalDetail = await getDeliveryDetail(request, token, deliveryId as string);
      expect(canonicalDetail.status).toBe('delivered');
      expect(canonicalDetail.payload.type).toBe('catalog.product.created');

      const aliasedDetail = await getDeliveryDetail(
        request,
        token,
        deliveryId as string,
        `/api/webhooks/webhook-deliveries/${deliveryId}`,
      );
      expect(aliasedDetail.id).toBe(deliveryId);
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
    }
  });

  test('should allow retrying a failed delivery after fixing the endpoint configuration', async ({ request }) => {
    const token = await getAuthToken(request);
    let webhookId: string | null = null;

    try {
      const created = await createWebhookFixture(request, token, {
        name: `Webhook Retry ${Date.now()}`,
        url: buildMockInboundUrl(),
        subscribedEvents: ['catalog.product.updated'],
        customHeaders: {
          'x-mock-webhook-signature': 'invalid',
        },
      });
      webhookId = created.id;

      const failedResponse = await apiRequest(request, 'POST', `/api/webhooks/${created.id}/test`, {
        token,
        data: {
          eventType: 'catalog.product.updated',
          payload: {
            type: 'catalog.product.updated',
            timestamp: new Date().toISOString(),
            data: {
              sku: `SKU-RETRY-${Date.now()}`,
            },
          },
        },
      });
      expect(failedResponse.status()).toBe(200);
      const failedBody = await readJsonSafe<{ delivery: { id: string; status: string; responseStatus: number | null } }>(failedResponse);
      expect(failedBody?.delivery.status).toBe('expired');
      expect(failedBody?.delivery.responseStatus).toBe(400);

      const deliveryId = failedBody?.delivery.id;
      expect(typeof deliveryId).toBe('string');

      const updateResponse = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token,
        data: {
          customHeaders: {
            'x-mock-webhook-signature': 'valid',
          },
        },
      });
      expect(updateResponse.status()).toBe(200);

      const retryResponse = await apiRequest(request, 'POST', `/api/webhooks/deliveries/${deliveryId}/retry`, { token });
      expect(retryResponse.status()).toBe(200);

      const deliveryAfterRetry = await waitForDeliveryStatus(request, token, deliveryId as string, 'delivered');
      expect(deliveryAfterRetry.responseStatus).toBe(200);
      expect(deliveryAfterRetry.attemptNumber).toBeGreaterThanOrEqual(2);
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
    }
  });
});
