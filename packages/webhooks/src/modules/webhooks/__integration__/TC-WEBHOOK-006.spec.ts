import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  buildMockInboundUrl,
  mockInboundAuthHeaders,
  createWebhookFixture,
  deleteWebhookIfExists,
  listWebhookDeliveries,
  sendTestDelivery,
} from './helpers/fixtures';

/**
 * TC-WEBHOOK-006: Webhook deactivation blocks delivery
 * Source: https://github.com/open-mercato/open-mercato/issues/2482
 *
 * The isActive flag must prevent delivery. The synchronous test route still records a
 * delivery attempt, but the delivery engine short-circuits inactive webhooks: the
 * delivery is marked `expired` with "Webhook is inactive" and no HTTP request is made
 * (responseStatus stays null). Re-activating restores successful delivery.
 */
test.describe('TC-WEBHOOK-006: Webhook deactivation blocks delivery', () => {
  test('should deliver while active, block while inactive, and resume after re-activation', async ({ request }) => {
    const token = await getAuthToken(request);
    let webhookId: string | null = null;

    try {
      const created = await createWebhookFixture(request, token, {
        name: `Webhook Deactivation ${Date.now()}`,
        url: buildMockInboundUrl(),
        subscribedEvents: ['catalog.product.created'],
        customHeaders: mockInboundAuthHeaders(),
      });
      webhookId = created.id;

      // 1) Active webhook delivers successfully.
      const activeDelivery = await sendTestDelivery(request, token, created.id, {
        eventType: 'catalog.product.created',
      });
      expect(activeDelivery.delivery.status).toBe('delivered');
      expect(activeDelivery.delivery.responseStatus).toBe(200);

      // 2) Deactivate.
      const deactivate = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token,
        data: { isActive: false },
      });
      expect(deactivate.status()).toBe(200);

      // 3) Inactive webhook does not reach the endpoint — delivery is expired, no HTTP attempt.
      const blockedDelivery = await sendTestDelivery(request, token, created.id, {
        eventType: 'catalog.product.created',
      });
      expect(blockedDelivery.delivery.status).toBe('expired');
      expect(blockedDelivery.delivery.errorMessage).toBe('Webhook is inactive');
      expect(blockedDelivery.delivery.responseStatus).toBeNull();

      // The blocked attempt is visible in the delivery log with a non-delivered status.
      const expiredDeliveries = await listWebhookDeliveries(
        request,
        token,
        created.id,
        `/api/webhooks/deliveries?webhookId=${encodeURIComponent(created.id)}&status=expired`,
      );
      expect(expiredDeliveries.items.some((item) => item.id === blockedDelivery.delivery.id)).toBe(true);
      expect(expiredDeliveries.items.every((item) => item.status === 'expired')).toBe(true);

      // 4) Re-activate and confirm delivery resumes.
      const reactivate = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token,
        data: { isActive: true },
      });
      expect(reactivate.status()).toBe(200);

      const resumedDelivery = await sendTestDelivery(request, token, created.id, {
        eventType: 'catalog.product.created',
      });
      expect(resumedDelivery.delivery.status).toBe('delivered');
      expect(resumedDelivery.delivery.responseStatus).toBe(200);
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
    }
  });
});
