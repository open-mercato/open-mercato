import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createOrganizationInDb, deleteOrganizationInDb } from '@open-mercato/core/helpers/integration/dbFixtures';
import {
  cleanupWebhooksUser,
  createWebhookFixture,
  deleteWebhookIfExists,
  listWebhooks,
  provisionWebhooksUser,
  type ProvisionedWebhooksUser,
  type WebhookCreateResponse,
} from './helpers/fixtures';

/**
 * TC-WEBHOOK-007: Tenant/organization scoping isolation
 * Source: https://github.com/open-mercato/open-mercato/issues/2482
 *
 * Webhooks are scoped by tenantId + organizationId. Within one tenant, two
 * organization-restricted users must not see or mutate each other's webhooks:
 * the list excludes out-of-scope rows and detail/update/delete on a foreign
 * webhook returns 404 (existence is not revealed across the org boundary).
 */
const MANAGE_FEATURES = ['webhooks.view', 'webhooks.manage'];

test.describe('TC-WEBHOOK-007: Tenant/organization scoping isolation', () => {
  test('should isolate webhooks between organizations within the same tenant', async ({ request }) => {
    const adminToken = await getAuthToken(request);
    const { tenantId, organizationId: orgA } = getTokenScope(adminToken);

    let orgB: string | null = null;
    let userA: ProvisionedWebhooksUser | null = null;
    let userB: ProvisionedWebhooksUser | null = null;
    let webhookA: WebhookCreateResponse | null = null;
    let webhookB: WebhookCreateResponse | null = null;

    try {
      orgB = await createOrganizationInDb({ name: `TC-WEBHOOK-007 Org B ${Date.now()}`, tenantId });

      userA = await provisionWebhooksUser(request, adminToken, {
        tenantId,
        organizationId: orgA,
        features: MANAGE_FEATURES,
        organizations: [orgA],
        slug: 'org-a',
      });
      userB = await provisionWebhooksUser(request, adminToken, {
        tenantId,
        organizationId: orgB,
        features: MANAGE_FEATURES,
        organizations: [orgB],
        slug: 'org-b',
      });

      webhookA = await createWebhookFixture(request, userA.token, {
        name: `TC-WEBHOOK-007 A ${Date.now()}`,
        url: 'https://example.com/webhook-org-a',
        subscribedEvents: ['catalog.product.created'],
      });
      webhookB = await createWebhookFixture(request, userB.token, {
        name: `TC-WEBHOOK-007 B ${Date.now()}`,
        url: 'https://example.com/webhook-org-b',
        subscribedEvents: ['catalog.product.created'],
      });

      // Lists are scoped: each user sees only their own organization's webhook.
      const listA = await listWebhooks(request, userA.token);
      expect(listA.items.some((item) => item.id === webhookA!.id)).toBe(true);
      expect(listA.items.some((item) => item.id === webhookB!.id)).toBe(false);

      const listB = await listWebhooks(request, userB.token);
      expect(listB.items.some((item) => item.id === webhookB!.id)).toBe(true);
      expect(listB.items.some((item) => item.id === webhookA!.id)).toBe(false);

      // Cross-org reads/writes are not found.
      const crossGet = await apiRequest(request, 'GET', `/api/webhooks/${webhookB.id}`, { token: userA.token });
      expect(crossGet.status()).toBe(404);

      const crossUpdate = await apiRequest(request, 'PUT', `/api/webhooks/${webhookB.id}`, {
        token: userA.token,
        data: { name: `TC-WEBHOOK-007 cross-org hijack ${Date.now()}` },
      });
      expect(crossUpdate.status()).toBe(404);

      const crossDelete = await apiRequest(request, 'DELETE', `/api/webhooks/${webhookB.id}`, { token: userA.token });
      expect(crossDelete.status()).toBe(404);

      const crossGetReverse = await apiRequest(request, 'GET', `/api/webhooks/${webhookA.id}`, { token: userB.token });
      expect(crossGetReverse.status()).toBe(404);

      // In-scope access still works after the cross-org attempts.
      const ownGet = await apiRequest(request, 'GET', `/api/webhooks/${webhookA.id}`, { token: userA.token });
      expect(ownGet.status()).toBe(200);
    } finally {
      await deleteWebhookIfExists(request, userA?.token ?? null, webhookA?.id ?? null);
      await deleteWebhookIfExists(request, userB?.token ?? null, webhookB?.id ?? null);
      await cleanupWebhooksUser(request, adminToken, userA);
      await cleanupWebhooksUser(request, adminToken, userB);
      await deleteOrganizationInDb(orgB);
    }
  });
});
