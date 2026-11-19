import { expect, test, type Page } from '@playwright/test';
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
 * TC-WEBHOOK-013: credential-like custom header values are hidden from callers without webhooks.secrets
 * Source: https://github.com/open-mercato/open-mercato/issues/7237
 *
 * A viewer (webhooks.view) and a manager without webhooks.secrets receive `••••••••` for
 * credential-like custom headers, while ordinary headers stay readable and an admin
 * (webhooks.*) still receives the stored values. Echoing the marker back keeps the stored
 * value, a marker without a stored value is refused, and a manager without webhooks.secrets
 * cannot keep hidden values while changing the webhook URL.
 */

const REDACTED = '••••••••';
const DESTINATION_TOKEN = 'Bearer tc-webhook-013-destination-token';

type WebhookDetail = { name: string; url: string; customHeaders: Record<string, string> | null };

async function readDetail(request: Parameters<typeof apiRequest>[0], token: string, id: string): Promise<WebhookDetail> {
  const response = await apiRequest(request, 'GET', `/api/webhooks/${id}`, { token });
  expect(response.status()).toBe(200);
  return (await response.json()) as WebhookDetail;
}

async function loginWithCredentials(page: Page, email: string, password: string): Promise<void> {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  await page.context().addCookies([
    { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    { name: 'om_feedback_suppress', value: '1', url: baseUrl, sameSite: 'Lax' },
  ]);
  await page.goto('/login');
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 });
  await page.getByLabel('Email').fill(email);
  const passwordInput = page.getByLabel('Password', { exact: true });
  await passwordInput.fill(password);
  await passwordInput.press('Enter');
  await expect(page).toHaveURL(/\/backend(?:\/.*)?$/, { timeout: 30_000 });
}

test.describe('TC-WEBHOOK-013: credential custom headers are hidden without webhooks.secrets', () => {
  test('redacts on read, keeps stored values on write, and refuses unsafe writes', async ({ request }) => {
    test.setTimeout(60_000);
    const adminToken = await getAuthToken(request);
    const scope = getTokenScope(adminToken);

    let webhookId: string | null = null;
    let viewer: ProvisionedWebhooksUser | null = null;
    let manager: ProvisionedWebhooksUser | null = null;

    try {
      viewer = await provisionWebhooksUser(request, adminToken, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        features: ['webhooks.view'],
        slug: 'cred-viewer',
      });
      manager = await provisionWebhooksUser(request, adminToken, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        features: ['webhooks.view', 'webhooks.manage'],
        slug: 'cred-manager',
      });

      const created = await createWebhookFixture(request, adminToken, {
        name: `Webhook credential headers ${Date.now()}`,
        url: 'https://example.com/tc-webhook-013',
        subscribedEvents: ['catalog.product.created'],
        customHeaders: { Authorization: DESTINATION_TOKEN, 'x-api-key': 'tc-013-api-key', 'x-source': 'qa' },
      });
      webhookId = created.id;

      const viewerDetail = await readDetail(request, viewer.token, created.id);
      expect(viewerDetail.customHeaders).toEqual({ Authorization: REDACTED, 'x-api-key': REDACTED, 'x-source': 'qa' });

      const aliasResponse = await apiRequest(request, 'GET', `/api/webhooks/webhooks/${created.id}`, { token: viewer.token });
      expect(aliasResponse.status()).toBe(200);
      expect(((await aliasResponse.json()) as WebhookDetail).customHeaders?.Authorization).toBe(REDACTED);

      const managerDetail = await readDetail(request, manager.token, created.id);
      expect(managerDetail.customHeaders?.Authorization).toBe(REDACTED);

      const adminDetail = await readDetail(request, adminToken, created.id);
      expect(adminDetail.customHeaders).toEqual({ Authorization: DESTINATION_TOKEN, 'x-api-key': 'tc-013-api-key', 'x-source': 'qa' });

      const renamed = `Webhook credential headers renamed ${Date.now()}`;
      const echoUpdate = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token: manager.token,
        data: { name: renamed, customHeaders: { ...managerDetail.customHeaders, 'x-source': 'erp' } },
      });
      expect(echoUpdate.status()).toBe(200);
      expect(((await echoUpdate.json()) as WebhookDetail).customHeaders?.Authorization).toBe(REDACTED);

      const afterEcho = await readDetail(request, adminToken, created.id);
      expect(afterEcho.name).toBe(renamed);
      expect(afterEcho.customHeaders).toEqual({ Authorization: DESTINATION_TOKEN, 'x-api-key': 'tc-013-api-key', 'x-source': 'erp' });

      const orphanMarker = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token: manager.token,
        data: { customHeaders: { 'x-new-token': REDACTED } },
      });
      expect(orphanMarker.status()).toBe(400);
      expect(((await orphanMarker.json()) as { error: string }).error).toContain('x-new-token');

      const moveWithHidden = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token: manager.token,
        data: { url: 'https://other.example.net/tc-webhook-013' },
      });
      expect(moveWithHidden.status()).toBe(400);

      const moveEchoingMarker = await apiRequest(request, 'PUT', `/api/webhooks/webhooks/${created.id}`, {
        token: manager.token,
        data: { url: 'https://other.example.net/tc-webhook-013', customHeaders: managerDetail.customHeaders },
      });
      expect(moveEchoingMarker.status()).toBe(400);

      const samePathMove = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token: manager.token,
        data: { url: 'https://example.com/tc-webhook-013-other-bin', customHeaders: managerDetail.customHeaders },
      });
      expect(samePathMove.status()).toBe(400);

      const unchanged = await readDetail(request, adminToken, created.id);
      expect(unchanged.url).toBe('https://example.com/tc-webhook-013');
      expect(unchanged.customHeaders).toEqual(afterEcho.customHeaders);

      const moveReentered = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token: manager.token,
        data: {
          url: 'https://other.example.net/tc-webhook-013',
          customHeaders: { Authorization: 'Bearer re-entered', 'x-source': 'erp' },
        },
      });
      expect(moveReentered.status()).toBe(200);

      const adminMove = await apiRequest(request, 'PUT', `/api/webhooks/${created.id}`, {
        token: adminToken,
        data: { url: 'https://example.com/tc-webhook-013', customHeaders: { Authorization: REDACTED, 'x-source': 'erp' } },
      });
      expect(adminMove.status()).toBe(200);
      expect(((await adminMove.json()) as WebhookDetail).customHeaders).toEqual({ Authorization: 'Bearer re-entered', 'x-source': 'erp' });
    } finally {
      await deleteWebhookIfExists(request, adminToken, webhookId);
      await cleanupWebhooksUser(request, adminToken, viewer);
      await cleanupWebhooksUser(request, adminToken, manager);
    }
  });

  test('shows hidden values in the UI and keeps them when a manager saves the edit form', async ({ browser, request }) => {
    test.setTimeout(120_000);
    const adminToken = await getAuthToken(request);
    const scope = getTokenScope(adminToken);

    let webhookId: string | null = null;
    let viewer: ProvisionedWebhooksUser | null = null;
    let manager: ProvisionedWebhooksUser | null = null;

    try {
      viewer = await provisionWebhooksUser(request, adminToken, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        features: ['webhooks.view'],
        slug: 'cred-ui-viewer',
      });
      manager = await provisionWebhooksUser(request, adminToken, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        features: ['webhooks.view', 'webhooks.manage'],
        slug: 'cred-ui-manager',
      });

      const created = await createWebhookFixture(request, adminToken, {
        name: `Webhook credential UI ${Date.now()}`,
        url: 'https://example.com/tc-webhook-013-ui',
        subscribedEvents: ['catalog.product.created'],
        customHeaders: { Authorization: DESTINATION_TOKEN, 'x-source': 'qa' },
      });
      webhookId = created.id;

      const viewerContext = await browser.newContext();
      try {
        const viewerPage = await viewerContext.newPage();
        await loginWithCredentials(viewerPage, viewer.email, viewer.password);
        await viewerPage.goto(`/backend/webhooks/${created.id}`);
        const headersCard = viewerPage.locator('pre').filter({ hasText: '"x-source": "qa"' });
        await expect(headersCard).toContainText(`"Authorization": "${REDACTED}"`);
        await expect(viewerPage.getByText(DESTINATION_TOKEN)).toHaveCount(0);
      } finally {
        await viewerContext.close();
      }

      const renamed = `Webhook credential UI renamed ${Date.now()}`;
      const managerContext = await browser.newContext();
      try {
        const managerPage = await managerContext.newPage();
        await loginWithCredentials(managerPage, manager.email, manager.password);
        await managerPage.goto(`/backend/webhooks/${created.id}`);
        await expect(managerPage.locator('pre').filter({ hasText: '"x-source": "qa"' })).toContainText(REDACTED);
        await managerPage.getByRole('button', { name: 'Actions' }).hover();
        await managerPage.getByRole('menuitem', { name: 'Edit' }).click();
        await expect(managerPage.getByText(`Hidden values (${REDACTED}) are kept when you save`)).toBeVisible();
        await expect(managerPage.getByText(DESTINATION_TOKEN)).toHaveCount(0);
        await expect(managerPage.getByPlaceholder('{"key": "value"}')).toHaveValue(new RegExp(`"Authorization": "${REDACTED}"`));
        const nameInput = managerPage.getByPlaceholder('My Webhook');
        await nameInput.fill(renamed);
        await expect(nameInput).toHaveValue(renamed);
        await managerPage.getByRole('button', { name: 'Save' }).first().click();
        await expect(managerPage.locator('pre').filter({ hasText: '"x-source": "qa"' })).toBeVisible({ timeout: 15_000 });
      } finally {
        await managerContext.close();
      }

      const adminDetail = await readDetail(request, adminToken, created.id);
      expect(adminDetail.name).toBe(renamed);
      expect(adminDetail.customHeaders).toEqual({ Authorization: DESTINATION_TOKEN, 'x-source': 'qa' });
    } finally {
      await deleteWebhookIfExists(request, adminToken, webhookId);
      await cleanupWebhooksUser(request, adminToken, viewer);
      await cleanupWebhooksUser(request, adminToken, manager);
    }
  });
});
