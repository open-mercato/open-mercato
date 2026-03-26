import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createWebhookFixture,
  deleteWebhookIfExists,
  getWebhookDetail,
  listWebhookEvents,
  listWebhooks,
} from './helpers/fixtures';

test.describe('TC-WEBHOOK-001: Webhook configuration CRUD', () => {
  test('should create, list, read, update, and delete webhook configurations while masking stored secrets', async ({ request }) => {
    const token = await getAuthToken(request);
    let webhookId: string | null = null;

    try {
      const events = await listWebhookEvents(request, token);
      expect(events.total).toBeGreaterThan(0);
      expect(events.data.every((event) => !event.id.startsWith('webhooks.'))).toBe(true);

      const created = await createWebhookFixture(request, token, {
        name: `Webhook CRUD ${Date.now()}`,
        url: 'https://example.com/webhook-crud',
        subscribedEvents: ['sales.quote.created'],
      });
      webhookId = created.id;

      const canonicalList = await listWebhooks(request, token);
      expect(canonicalList.items.some((item) => item.id === created.id)).toBe(true);

      const aliasedList = await listWebhooks(request, token, '/api/webhooks/webhooks');
      expect(aliasedList.items.some((item) => item.id === created.id)).toBe(true);

      const detail = await getWebhookDetail(request, token, created.id);
      expect(detail.name).toBe(created.name);
      expect(detail.url).toBe('https://example.com/webhook-crud');
      expect(detail.maskedSecret).toContain(created.secret.slice(0, 6));
      expect(detail.maskedSecret).not.toBe(created.secret);
      expect(detail.previousSecretSetAt).toBeNull();

      const aliasedDetail = await getWebhookDetail(request, token, created.id, `/api/webhooks/webhooks/${created.id}`);
      expect(aliasedDetail.id).toBe(created.id);

      const updateResponse = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token,
        data: {
          name: `Webhook CRUD Updated ${Date.now()}`,
          description: 'Updated by integration test',
          url: 'https://example.com/webhook-updated',
          subscribedEvents: ['catalog.product.updated'],
          isActive: false,
          customHeaders: {
            'x-test-suite': 'webhooks',
          },
        },
      });
      expect(updateResponse.status()).toBe(200);
      const updated = await readJsonSafe<Awaited<ReturnType<typeof getWebhookDetail>>>(updateResponse);
      expect(updated?.isActive).toBe(false);
      expect(updated?.customHeaders).toEqual({ 'x-test-suite': 'webhooks' });

      const deleteResponse = await apiRequest(request, 'DELETE', `/api/webhooks/${created.id}`, { token });
      expect(deleteResponse.status()).toBe(200);
      webhookId = null;

      const deletedDetailResponse = await apiRequest(request, 'GET', `/api/webhooks/${created.id}`, { token });
      expect(deletedDetailResponse.status()).toBe(404);
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
    }
  });
});
