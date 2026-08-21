import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { readIntegrationEnvFlag } from '@open-mercato/core/helpers/integration/standaloneEnv';
import { createWebhookFixture, deleteWebhookIfExists } from './helpers/fixtures';

/**
 * TC-WEBHOOK-009: Invalid and unsafe URL rejection
 * Source: https://github.com/open-mercato/open-mercato/issues/2482
 *
 * Webhook URLs go through the shared outbound-URL safety check. Forbidden schemes,
 * embedded credentials, and malformed URLs are rejected with 400 on both create and
 * update regardless of configuration. Private/loopback hosts are rejected unless the
 * deployment opts in via OM_WEBHOOKS_ALLOW_PRIVATE_URLS (the integration env enables
 * it so the loopback mock receiver works) — this spec asserts whichever behavior the
 * active flag dictates. Exhaustive private-IP coverage lives in the unit suites
 * (data/__tests__/validators.test.ts, lib/__tests__/url-safety.test.ts).
 */
const PRIVATE_URLS_ALLOWED = readIntegrationEnvFlag('OM_WEBHOOKS_ALLOW_PRIVATE_URLS');

const ALWAYS_UNSAFE_URLS = [
  'ftp://example.com/webhook',
  'file:///etc/passwd',
  'http://user:pass@example.com/webhook',
  'not-a-valid-url',
];

const PRIVATE_HOST_URLS = [
  'http://127.0.0.1:9001/webhook',
  'http://10.0.0.1/webhook',
  'http://[::1]:9001/webhook',
];

function createBody(url: string) {
  return {
    name: `Webhook URL Safety ${Date.now()}`,
    url,
    subscribedEvents: ['catalog.product.created'],
  };
}

test.describe('TC-WEBHOOK-009: Invalid and unsafe URL rejection', () => {
  test('should reject unsafe webhook URLs on create and update and accept valid external URLs', async ({ request }) => {
    const token = await getAuthToken(request);
    let webhookId: string | null = null;
    const strayPrivateWebhookIds: string[] = [];

    try {
      // Always-unsafe URLs are rejected at create regardless of the private-URL flag.
      for (const url of ALWAYS_UNSAFE_URLS) {
        const response = await apiRequest(request, 'POST', '/api/webhooks', { token, data: createBody(url) });
        expect(response.status(), `POST should reject unsafe url ${url}`).toBe(400);
      }

      // A valid external https URL is accepted.
      const created = await createWebhookFixture(request, token, {
        name: `Webhook URL Safety Valid ${Date.now()}`,
        url: 'https://example.com/webhook-url-safety',
        subscribedEvents: ['catalog.product.created'],
      });
      webhookId = created.id;

      // Updating an existing webhook to an unsafe URL is rejected; the record is unchanged.
      for (const url of ALWAYS_UNSAFE_URLS) {
        const response = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, { token, data: { url } });
        expect(response.status(), `PUT should reject unsafe url ${url}`).toBe(400);
      }

      // Updating to another valid external URL succeeds.
      const validUpdate = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token,
        data: { url: 'https://example.org/webhook-url-safety-updated' },
      });
      expect(validUpdate.status()).toBe(200);

      // Private/loopback hosts: behavior depends on the deployment flag.
      for (const url of PRIVATE_HOST_URLS) {
        const response = await apiRequest(request, 'POST', '/api/webhooks', { token, data: createBody(url) });
        if (PRIVATE_URLS_ALLOWED) {
          expect(response.status(), `POST should accept private url ${url} when allowed`).toBe(201);
          const body = await readJsonSafe<{ id?: string }>(response);
          if (body?.id) strayPrivateWebhookIds.push(body.id);
        } else {
          expect(response.status(), `POST should reject private url ${url} when not allowed`).toBe(400);
        }
      }
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
      for (const id of strayPrivateWebhookIds) {
        await deleteWebhookIfExists(request, token, id);
      }
    }
  });
});
