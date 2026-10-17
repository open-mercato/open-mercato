import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { expectConflictBody, putWithLock } from '@open-mercato/core/helpers/integration/optimisticLockUi';
import {
  createWebhookFixture,
  deleteWebhookIfExists,
  getWebhookDetail,
  type WebhookDetailResponse,
} from './helpers/fixtures';

/**
 * TC-WEBHOOK-011: A partial webhook update keeps the omitted delivery settings
 *
 * `PUT /api/webhooks/:id` must change only the fields the caller sends. The
 * activate/deactivate actions send `{ isActive }` alone; they must not reset the
 * HTTP method, retries, timeout, rate limit or auto-disable threshold to the
 * create defaults. A stale optimistic-lock header and a foreign selected
 * organization must both leave the row untouched.
 */

type WebhookSettings = Pick<
  WebhookDetailResponse,
  | 'name'
  | 'description'
  | 'url'
  | 'subscribedEvents'
  | 'httpMethod'
  | 'isActive'
  | 'deliveryStrategy'
  | 'maxRetries'
  | 'timeoutMs'
  | 'rateLimitPerMinute'
  | 'autoDisableThreshold'
  | 'customHeaders'
  | 'integrationId'
>;

function pickSettings(detail: WebhookDetailResponse): WebhookSettings {
  return {
    name: detail.name,
    description: detail.description,
    url: detail.url,
    subscribedEvents: detail.subscribedEvents,
    httpMethod: detail.httpMethod,
    isActive: detail.isActive,
    deliveryStrategy: detail.deliveryStrategy,
    maxRetries: detail.maxRetries,
    timeoutMs: detail.timeoutMs,
    rateLimitPerMinute: detail.rateLimitPerMinute,
    autoDisableThreshold: detail.autoDisableThreshold,
    customHeaders: detail.customHeaders,
    integrationId: detail.integrationId,
  };
}

async function readSettings(
  request: APIRequestContext,
  token: string,
  webhookId: string,
): Promise<WebhookSettings> {
  return pickSettings(await getWebhookDetail(request, token, webhookId));
}

async function putWebhook(
  request: APIRequestContext,
  token: string,
  webhookId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', `/api/webhooks/${webhookId}`, { token, data });
  expect(response.status(), `PUT ${JSON.stringify(data)} should succeed`).toBe(200);
}

test.describe('TC-WEBHOOK-011: Partial webhook update keeps omitted delivery settings', () => {
  test('activate/deactivate and single-field updates change only the sent fields', async ({ page }) => {
    test.setTimeout(90_000);
    const request = page.request;
    const token = await getAuthToken(request, 'admin');
    const stamp = Date.now();
    let webhookId: string | null = null;
    let organizationId: string | null = null;

    try {
      const created = await createWebhookFixture(request, token, {
        name: `QA Webhook 011 ${stamp}`,
        description: 'Partial update keeps settings',
        url: `https://qa-webhook-011-${stamp}.example.com/hook`,
        subscribedEvents: ['catalog.product.created'],
        httpMethod: 'PUT',
        maxRetries: 3,
        timeoutMs: 5_000,
        rateLimitPerMinute: 7,
        autoDisableThreshold: 5,
        customHeaders: { 'x-qa-webhook': '011' },
      });
      const id = created.id;
      webhookId = id;

      const initial = await readSettings(request, token, id);
      expect(initial).toMatchObject({
        httpMethod: 'PUT',
        isActive: true,
        maxRetries: 3,
        timeoutMs: 5_000,
        rateLimitPerMinute: 7,
        autoDisableThreshold: 5,
      });

      let expected: WebhookSettings = { ...initial };

      await test.step('API deactivate and re-activate keep every other setting', async () => {
        await putWebhook(request, token, id, { isActive: false });
        expect(await readSettings(request, token, id)).toEqual({ ...expected, isActive: false });

        await putWebhook(request, token, id, { isActive: true });
        expect(await readSettings(request, token, id)).toEqual(expected);
      });

      await test.step('API single-field update changes only that field', async () => {
        await putWebhook(request, token, id, { maxRetries: 4 });
        expected = { ...expected, maxRetries: 4 };
        expect(await readSettings(request, token, id)).toEqual(expected);
      });

      await test.step('UI detail-page Deactivate keeps every other setting', async () => {
        await login(page, 'admin');
        await page.goto(`/backend/webhooks/${id}`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: `QA Webhook 011 ${stamp}` })).toBeVisible({ timeout: 20_000 });

        const trigger = page.getByRole('button', { name: 'Actions', exact: true });
        const deactivateItem = page.getByRole('menuitem', { name: /^deactivate$/i });
        await expect(async () => {
          if ((await readSettings(request, token, id)).isActive === false) return;
          if (!(await deactivateItem.isVisible().catch(() => false))) {
            await trigger.click({ timeout: 2_000 });
            await expect(deactivateItem).toBeVisible({ timeout: 1_500 });
          }
          await deactivateItem.click({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });

        await expect
          .poll(async () => (await readSettings(request, token, id)).isActive, { timeout: 15_000 })
          .toBe(false);
        expect(await readSettings(request, token, id)).toEqual({ ...expected, isActive: false });

        await putWebhook(request, token, id, { isActive: true });
        expect(await readSettings(request, token, id)).toEqual(expected);
      });

      await test.step('stale optimistic-lock header is refused and changes nothing', async () => {
        const staleUpdatedAt = (await getWebhookDetail(request, token, id)).updatedAt;
        await putWebhook(request, token, id, { description: `Bumped ${stamp}` });
        expected = { ...expected, description: `Bumped ${stamp}` };
        const bumped = await getWebhookDetail(request, token, id);
        expect(bumped.updatedAt).not.toBe(staleUpdatedAt);

        const conflict = await putWithLock(request, token, `/api/webhooks/${id}`, { isActive: false }, staleUpdatedAt);
        await expectConflictBody(conflict);

        const after = await getWebhookDetail(request, token, id);
        expect(pickSettings(after)).toEqual(expected);
        expect(after.updatedAt).toBe(bumped.updatedAt);
      });

      await test.step('another selected organization cannot update the webhook', async () => {
        organizationId = await createOrganizationFixture(request, token, { name: `QA Webhook 011 Org ${stamp}` });
        const before = await getWebhookDetail(request, token, id);

        const response = await apiRequestWithSelectedOrg(request, 'PUT', `/api/webhooks/${id}`, {
          token,
          selectedOrgId: organizationId,
          data: { isActive: false },
        });
        expect(response.status(), 'PUT with a foreign selected organization should be 404').toBe(404);

        const after = await getWebhookDetail(request, token, id);
        expect(pickSettings(after)).toEqual(expected);
        expect(after.isActive).toBe(true);
        expect(after.updatedAt).toBe(before.updatedAt);
      });
    } finally {
      await deleteWebhookIfExists(request, token, webhookId);
      await deleteOrganizationIfExists(request, token, organizationId);
    }
  });
});
