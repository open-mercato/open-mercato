import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  buildMockInboundUrl,
  mockInboundAuthHeaders,
  mockInboundInvalidAuthHeaders,
  createWebhookFixture,
  deleteWebhookIfExists,
  listWebhookDeliveries,
  sendTestDelivery,
} from './helpers/fixtures';

/**
 * TC-WEBHOOK-008: Delivery list filtering by status and event type
 * Source: https://github.com/open-mercato/open-mercato/issues/2482
 *
 * GET /api/webhooks/deliveries supports webhookId, status, and eventType filters.
 * Seeds three deliveries on one webhook — delivered(created), delivered(updated),
 * expired(created) — then verifies each filter and their intersection.
 */
const EVENT_CREATED = 'catalog.product.created';
const EVENT_UPDATED = 'catalog.product.updated';

function deliveriesPath(webhookId: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ webhookId, ...extra });
  return `/api/webhooks/deliveries?${params.toString()}`;
}

test.describe('TC-WEBHOOK-008: Delivery list filtering by status and event type', () => {
  test('should filter delivery logs by status, event type, and their combination', async ({ request }) => {
    const token = await getAuthToken(request);
    let webhookId: string | null = null;

    try {
      const created = await createWebhookFixture(request, token, {
        name: `Webhook Filter ${Date.now()}`,
        url: buildMockInboundUrl(),
        subscribedEvents: [EVENT_CREATED, EVENT_UPDATED],
        customHeaders: mockInboundAuthHeaders(),
      });
      webhookId = created.id;

      const deliveredCreated = await sendTestDelivery(request, token, created.id, { eventType: EVENT_CREATED });
      expect(deliveredCreated.delivery.status).toBe('delivered');
      const deliveredUpdated = await sendTestDelivery(request, token, created.id, { eventType: EVENT_UPDATED });
      expect(deliveredUpdated.delivery.status).toBe('delivered');

      // Flip the mock signature to invalid so the next attempt fails terminally (expired).
      const invalidate = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token,
        data: { customHeaders: mockInboundInvalidAuthHeaders() },
      });
      expect(invalidate.status()).toBe(200);

      const expiredCreated = await sendTestDelivery(request, token, created.id, { eventType: EVENT_CREATED });
      expect(expiredCreated.delivery.status).toBe('expired');

      const d1 = deliveredCreated.delivery.id;
      const d2 = deliveredUpdated.delivery.id;
      const d3 = expiredCreated.delivery.id;

      // Unfiltered (by webhook): all three present.
      const all = await listWebhookDeliveries(request, token, created.id, deliveriesPath(created.id));
      expect(all.total).toBeGreaterThanOrEqual(3);
      for (const id of [d1, d2, d3]) {
        expect(all.items.some((item) => item.id === id)).toBe(true);
      }

      // status=delivered → d1, d2 only.
      const delivered = await listWebhookDeliveries(request, token, created.id, deliveriesPath(created.id, { status: 'delivered' }));
      expect(delivered.items.every((item) => item.status === 'delivered')).toBe(true);
      expect(delivered.items.some((item) => item.id === d1)).toBe(true);
      expect(delivered.items.some((item) => item.id === d2)).toBe(true);
      expect(delivered.items.some((item) => item.id === d3)).toBe(false);

      // status=expired → d3 only.
      const expired = await listWebhookDeliveries(request, token, created.id, deliveriesPath(created.id, { status: 'expired' }));
      expect(expired.items.every((item) => item.status === 'expired')).toBe(true);
      expect(expired.items.some((item) => item.id === d3)).toBe(true);
      expect(expired.items.some((item) => item.id === d1)).toBe(false);

      // eventType=created → d1, d3 only.
      const createdEvents = await listWebhookDeliveries(request, token, created.id, deliveriesPath(created.id, { eventType: EVENT_CREATED }));
      expect(createdEvents.items.every((item) => item.eventType === EVENT_CREATED)).toBe(true);
      expect(createdEvents.items.some((item) => item.id === d1)).toBe(true);
      expect(createdEvents.items.some((item) => item.id === d3)).toBe(true);
      expect(createdEvents.items.some((item) => item.id === d2)).toBe(false);

      // Combined status=delivered & eventType=created → d1 only.
      const combined = await listWebhookDeliveries(
        request,
        token,
        created.id,
        deliveriesPath(created.id, { status: 'delivered', eventType: EVENT_CREATED }),
      );
      expect(combined.items.every((item) => item.status === 'delivered' && item.eventType === EVENT_CREATED)).toBe(true);
      expect(combined.items.some((item) => item.id === d1)).toBe(true);
      expect(combined.items.some((item) => item.id === d2)).toBe(false);
      expect(combined.items.some((item) => item.id === d3)).toBe(false);

      // Non-matching filter → empty result set with pagination metadata.
      const empty = await listWebhookDeliveries(request, token, created.id, deliveriesPath(created.id, { status: 'pending' }));
      expect(empty.items).toEqual([]);
      expect(empty.total).toBe(0);
      expect(empty.page).toBe(1);
      expect(empty.totalPages).toBe(0);
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
    }
  });
});
