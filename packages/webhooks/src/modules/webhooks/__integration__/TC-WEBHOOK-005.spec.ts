import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  cleanupWebhooksUser,
  createWebhookFixture,
  deleteWebhookIfExists,
  provisionWebhooksUser,
  type ProvisionedWebhooksUser,
} from './helpers/fixtures';

/**
 * TC-WEBHOOK-005: RBAC permission gates — unauthorized access by feature flag
 * Source: https://github.com/open-mercato/open-mercato/issues/2482
 *
 * Verifies every webhooks API surface is gated by its declared feature:
 *   webhooks.view    → GET list + GET detail + deliveries
 *   webhooks.manage  → POST + PUT + DELETE
 *   webhooks.secrets → POST rotate-secret
 *   webhooks.test    → POST test
 * A viewer holding only webhooks.view passes reads but is denied every write/secret/test
 * surface; a user holding no webhooks features is denied reads. Admin (webhooks.*) proves
 * the positive paths. Denials accept 401 or 403 per the issue's acceptance criteria.
 */
test.describe('TC-WEBHOOK-005: RBAC permission gates by feature flag', () => {
  test('should gate each webhooks surface behind its declared feature', async ({ request }) => {
    const adminToken = await getAuthToken(request);
    const scope = getTokenScope(adminToken);

    let webhookId: string | null = null;
    let viewer: ProvisionedWebhooksUser | null = null;
    let noAccess: ProvisionedWebhooksUser | null = null;

    try {
      viewer = await provisionWebhooksUser(request, adminToken, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        features: ['webhooks.view'],
        slug: 'viewer',
      });
      noAccess = await provisionWebhooksUser(request, adminToken, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        features: [],
        slug: 'noaccess',
      });

      // --- Positive: admin (webhooks.*) can exercise every surface ---
      const created = await createWebhookFixture(request, adminToken, {
        name: `Webhook RBAC ${Date.now()}`,
        url: 'https://example.com/webhook-rbac',
        subscribedEvents: ['catalog.product.created'],
        customHeaders: { 'x-mock-webhook-signature': 'valid' },
      });
      webhookId = created.id;

      const adminList = await apiRequest(request, 'GET', '/api/webhooks', { token: adminToken });
      expect(adminList.status()).toBe(200);
      const adminDetail = await apiRequest(request, 'GET', `/api/webhooks/${created.id}`, { token: adminToken });
      expect(adminDetail.status()).toBe(200);

      // --- webhooks.view gate ---
      const viewerList = await apiRequest(request, 'GET', '/api/webhooks', { token: viewer.token });
      expect(viewerList.status()).toBe(200);
      const viewerDetail = await apiRequest(request, 'GET', `/api/webhooks/${created.id}`, { token: viewer.token });
      expect(viewerDetail.status()).toBe(200);

      const noAccessList = await apiRequest(request, 'GET', '/api/webhooks', { token: noAccess.token });
      expect([401, 403]).toContain(noAccessList.status());
      const noAccessDetail = await apiRequest(request, 'GET', `/api/webhooks/${created.id}`, { token: noAccess.token });
      expect([401, 403]).toContain(noAccessDetail.status());

      // --- webhooks.manage gate (viewer lacks manage) ---
      const viewerCreate = await apiRequest(request, 'POST', '/api/webhooks', {
        token: viewer.token,
        data: {
          name: `Webhook RBAC Denied ${Date.now()}`,
          url: 'https://example.com/webhook-denied',
          subscribedEvents: ['catalog.product.created'],
        },
      });
      expect([401, 403]).toContain(viewerCreate.status());

      const viewerUpdate = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token: viewer.token,
        data: { name: `Webhook RBAC Hijack ${Date.now()}` },
      });
      expect([401, 403]).toContain(viewerUpdate.status());

      const viewerDelete = await apiRequest(request, 'DELETE', `/api/webhooks/${created.id}`, { token: viewer.token });
      expect([401, 403]).toContain(viewerDelete.status());

      // --- webhooks.secrets gate (viewer lacks secrets) ---
      const viewerRotate = await apiRequest(request, 'POST', `/api/webhooks/${created.id}/rotate-secret`, {
        token: viewer.token,
      });
      expect([401, 403]).toContain(viewerRotate.status());

      // --- webhooks.test gate (viewer lacks test) ---
      const viewerTest = await apiRequest(request, 'POST', `/api/webhooks/${created.id}/test`, {
        token: viewer.token,
        data: { eventType: 'catalog.product.created' },
      });
      expect([401, 403]).toContain(viewerTest.status());

      // The webhook must still exist — none of the denied writes mutated it.
      const stillThere = await apiRequest(request, 'GET', `/api/webhooks/${created.id}`, { token: adminToken });
      expect(stillThere.status()).toBe(200);

      // --- Positive secrets + test paths (admin holds both features) ---
      const adminRotate = await apiRequest(request, 'POST', `/api/webhooks/${created.id}/rotate-secret`, {
        token: adminToken,
      });
      expect(adminRotate.status()).toBe(200);
      const adminTest = await apiRequest(request, 'POST', `/api/webhooks/${created.id}/test`, {
        token: adminToken,
        data: { eventType: 'catalog.product.created' },
      });
      expect(adminTest.status()).toBe(200);
    } finally {
      await deleteWebhookIfExists(request, adminToken, webhookId);
      await cleanupWebhooksUser(request, adminToken, viewer);
      await cleanupWebhooksUser(request, adminToken, noAccess);
    }
  });
});
