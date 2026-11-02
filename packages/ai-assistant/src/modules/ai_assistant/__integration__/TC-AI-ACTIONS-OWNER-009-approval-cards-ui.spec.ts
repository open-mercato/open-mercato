import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  seedPendingActionInDb,
  deletePendingActionInDb,
  readPendingActionStateInDb,
  readCatalogProductTitleInDb,
} from './helpers/aiAssistantFixtures';

/**
 * TC-AI-ACTIONS-OWNER-009 — the approval cards in the browser honour the
 * owner scope and the tool-feature re-check from TC-AI-ACTIONS-OWNER-008.
 * Source: GitHub issue #3806 (UI QA follow-up on PR #7329).
 *
 * Pending actions have no public create route and no AI provider is needed:
 * rows are seeded via SQL and mounted through the playground's
 * `?uiPart=<card>&pendingActionId=<id>` debug seed. Everything after mount
 * (GET, confirm) goes through the real routes. The agents list is stubbed so
 * the playground deterministically opens a chat lane.
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000';
const PLAYGROUND = '/backend/config/ai-assistant/playground';
const AGENT_ID = 'catalog.merchandising_assistant';
const TOOL_NAME = 'catalog.update_product';
const PASSWORD = 'Secret123!';

type Cleanup = () => Promise<void>;

async function createLimitedUser(
  request: APIRequestContext,
  adminToken: string,
  organizationId: string,
  cleanups: Cleanup[],
): Promise<{ userId: string; token: string }> {
  const stamp = randomUUID().slice(0, 8);
  const email = `it-owner-ui-${stamp}@example.com`;
  const roleId = await createRoleFixture(request, adminToken, { name: `IT Owner UI ${stamp}` });
  cleanups.push(() => deleteRoleIfExists(request, adminToken, roleId));
  await setRoleAclFeatures(request, adminToken, {
    roleId,
    features: ['ai_assistant.view', 'ai_assistant.settings.manage', 'catalog.products.view'],
    organizations: null,
  });
  const userId = await createUserFixture(request, adminToken, {
    email,
    password: PASSWORD,
    organizationId,
    roles: [roleId],
  });
  cleanups.push(async () => {
    await deleteUserAclInDb(userId).catch(() => undefined);
    await deleteUserIfExists(request, adminToken, userId);
  });
  return { userId, token: await getAuthToken(request, email, PASSWORD) };
}

async function loginWithToken(page: Page, token: string): Promise<void> {
  const scope = getTokenScope(token);
  await page.context().addCookies([
    { name: 'auth_token', value: token, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: scope.tenantId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: scope.organizationId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url: BASE_URL },
    { name: 'om_cookie_notice_ack', value: 'ack', url: BASE_URL },
    { name: 'om_feedback_suppress', value: '1', url: BASE_URL },
  ]);
  await page.route('**/api/ai_assistant/ai/agents', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agents: [
          {
            id: AGENT_ID,
            moduleId: 'catalog',
            label: 'Merchandising assistant',
            description: 'Proposes catalog product changes.',
            executionMode: 'chat',
            mutationPolicy: 'confirm-required',
            allowedTools: [TOOL_NAME],
            requiredFeatures: ['catalog.products.view'],
            acceptedMediaTypes: [],
            hasOutputSchema: false,
          },
        ],
        total: 1,
      }),
    });
  });
}

async function openCard(page: Page, uiPart: string, pendingActionId: string): Promise<void> {
  await page.goto(`${PLAYGROUND}?uiPart=${uiPart}&pendingActionId=${pendingActionId}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-ai-playground]')).toBeVisible({ timeout: 60_000 });
}

test.describe('TC-AI-ACTIONS-OWNER-009: approval cards honour owner scope and the tool feature re-check', () => {
  test('a non-owner sees an unavailable card and a refused confirm shows the permission alert', async ({ page, request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId: adminId } = getTokenScope(adminToken);
    const cleanups: Cleanup[] = [];
    try {
      const productId = await createProductFixture(request, adminToken, {
        title: `IT owner UI product ${randomUUID().slice(0, 8)}`,
        sku: `IT-OWN-UI-${randomUUID().slice(0, 8)}`,
      });
      cleanups.push(() => deleteCatalogProductIfExists(request, adminToken, productId));
      const originalTitle = await readCatalogProductTitleInDb(productId);

      const limited = await createLimitedUser(request, adminToken, organizationId, cleanups);

      const adminRow = await seedPendingActionInDb({
        tenantId,
        organizationId: organizationId || null,
        createdByUserId: adminId,
        agentId: AGENT_ID,
        toolName: TOOL_NAME,
        normalizedInput: { productId, title: 'Proposed by admin' },
      });
      cleanups.push(() => deletePendingActionInDb(adminRow.id));
      const limitedRow = await seedPendingActionInDb({
        tenantId,
        organizationId: organizationId || null,
        createdByUserId: limited.userId,
        agentId: AGENT_ID,
        toolName: TOOL_NAME,
        normalizedInput: { productId, title: 'Proposed without manage' },
      });
      cleanups.push(() => deletePendingActionInDb(limitedRow.id));

      await loginWithToken(page, limited.token);

      await openCard(page, 'mutation-preview-card', adminRow.id);
      await expect(page.locator('[data-ai-mutation-preview-unavailable]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-ai-mutation-preview-confirm]')).toHaveCount(0);
      await expect(page.locator('[data-ai-mutation-preview-cancel]')).toHaveCount(0);
      await expect(page.locator('[data-ai-mutation-preview-body]')).toHaveCount(0);

      await openCard(page, 'confirmation-card', adminRow.id);
      const confirmationCard = page.locator('[data-ai-confirmation-card]').first();
      await expect(confirmationCard).toHaveAttribute('data-ai-confirmation-status', 'unavailable', { timeout: 15_000 });
      await expect(page.locator('[data-ai-confirmation-cancel]')).toHaveCount(0);

      await openCard(page, 'mutation-preview-card', limitedRow.id);
      const confirmButton = page.locator('[data-ai-mutation-preview-confirm]');
      await expect(confirmButton).toBeVisible({ timeout: 15_000 });
      const confirmResponse = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/ai_assistant/ai/actions/${limitedRow.id}/confirm`) &&
          response.request().method() === 'POST',
      );
      await confirmButton.click();
      expect((await confirmResponse).status()).toBe(403);
      await expect(page.locator('[data-ai-confirmation-error="tool_features_denied"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-ai-mutation-preview-cancel]')).toBeVisible();

      expect((await readPendingActionStateInDb(limitedRow.id))?.status).toBe('pending');
      expect((await readPendingActionStateInDb(adminRow.id))?.status).toBe('pending');
      expect(await readCatalogProductTitleInDb(productId)).toBe(originalTitle);
    } finally {
      for (const cleanup of cleanups.reverse()) {
        await cleanup().catch(() => undefined);
      }
    }
  });
});
