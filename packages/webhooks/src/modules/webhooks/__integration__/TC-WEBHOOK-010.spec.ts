import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  buildMockInboundUrl,
  createWebhookFixture,
  deleteWebhookIfExists,
  getDeliveryDetail,
  sendTestDelivery,
} from './helpers/fixtures';

/**
 * TC-WEBHOOK-010: Delivery detail response includes full payload and response body
 * Source: https://github.com/open-mercato/open-mercato/issues/2482
 *
 * The delivery detail endpoint must expose the complete sent payload and the full
 * response captured from the endpoint (status, body, headers) plus attempt/timing
 * metadata, so admins can debug a delivery end-to-end.
 */
const EVENT_TYPE = 'webhooks.test.detail';

test.describe('TC-WEBHOOK-010: Delivery detail full payload and response body', () => {
  test('should expose the complete payload and response details for a delivery', async ({ request }) => {
    const token = await getAuthToken(request);
    let webhookId: string | null = null;

    try {
      const created = await createWebhookFixture(request, token, {
        name: `Webhook Detail ${Date.now()}`,
        url: buildMockInboundUrl(),
        subscribedEvents: ['catalog.product.created'],
        customHeaders: { 'x-mock-webhook-signature': 'valid' },
      });
      webhookId = created.id;

      const eventData = { sku: 'TEST-123', nested: { value: 42 } };

      const testResult = await sendTestDelivery(request, token, created.id, {
        eventType: EVENT_TYPE,
        payload: eventData,
      });
      expect(testResult.delivery.status).toBe('delivered');
      const deliveryId = testResult.delivery.id;

      const detail = await getDeliveryDetail(request, token, deliveryId);

      // Identity + routing
      expect(detail.id).toBe(deliveryId);
      expect(detail.webhookId).toBe(created.id);
      expect(detail.eventType).toBe(EVENT_TYPE);
      expect(detail.targetUrl).toBe(created.url);
      expect(typeof detail.messageId).toBe('string');
      expect(detail.messageId.length).toBeGreaterThan(0);

      // Outcome
      expect(detail.status).toBe('delivered');
      expect(detail.responseStatus).toBe(200);
      expect(detail.errorMessage).toBeNull();

      // The delivery body wraps the event data in the Standard-Webhooks envelope
      // { type, timestamp, data }; the sent payload is preserved under `data`.
      expect(detail.payload).toMatchObject({
        type: EVENT_TYPE,
        data: { sku: 'TEST-123', nested: { value: 42 } },
      });
      const envelopeTimestamp = (detail.payload as { timestamp?: unknown }).timestamp;
      expect(typeof envelopeTimestamp).toBe('string');
      expect(Number.isNaN(Date.parse(envelopeTimestamp as string))).toBe(false);

      // Full captured response (the mock receiver replies { ok: true } as JSON)
      expect(detail.responseBody).toBe(JSON.stringify({ ok: true }));
      expect(detail.responseHeaders).not.toBeNull();
      expect(detail.responseHeaders?.['content-type']).toContain('application/json');

      // Attempt + timing metadata
      expect(detail.attemptNumber).toBeGreaterThanOrEqual(1);
      expect(detail.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(typeof detail.durationMs).toBe('number');
      expect(detail.durationMs as number).toBeGreaterThanOrEqual(0);
      expect(detail.nextRetryAt).toBeNull();

      for (const timestamp of [detail.createdAt, detail.enqueuedAt, detail.lastAttemptAt, detail.deliveredAt, detail.updatedAt]) {
        expect(typeof timestamp).toBe('string');
        expect(Number.isNaN(Date.parse(timestamp as string))).toBe(false);
      }
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
    }
  });
});
