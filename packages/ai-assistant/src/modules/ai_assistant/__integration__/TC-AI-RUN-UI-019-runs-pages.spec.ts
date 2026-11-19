import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures';
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  deleteAgentRunsInDb,
  deleteConversationCascadeInDb,
  seedAgentRunInDb,
} from './helpers/aiAssistantFixtures';
import { createConversationFixture } from './helpers/agentRunChat';

/**
 * TC-AI-RUN-UI-019: agent runs list and detail pages.
 *
 * Spec `2026-10-21-chat-run-tracing-and-citations` Phase 3. A seeded run (no
 * LLM needed) drives the real pages:
 *   - the list page hydrates without errors, filters by agent and opens the
 *     run detail;
 *   - the detail page shows the trace and links to the conversation;
 *   - the empty state renders when the API returns no runs;
 *   - a user without `ai_assistant.runs.view` gets Access Denied on both pages.
 */
const RUNS_PAGE = '/backend/config/ai-assistant/runs';
const AGENT_FILTER_PLACEHOLDER = 'Agent id, e.g. catalog.merchandiser';
const PASSWORD = 'Secret123!';

async function loginWithCredentials(page: Page, email: string, password: string): Promise<void> {
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: new URLSearchParams({ email, password }).toString(),
  });
  expect(response.ok(), 'fixture user login').toBeTruthy();
}

test.describe('TC-AI-RUN-UI-019: agent runs pages', () => {
  test('list filters by agent, opens the detail and links to the conversation', async ({ page, request }) => {
    test.slow();
    const adminToken = await getAuthToken(request, 'admin');
    const { tenantId, organizationId, userId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const agentId = `it_runs_ui.agent_${stamp}`;
    const conversationId = `it-runs-ui-${randomUUID()}`;
    let runId: string | null = null;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await createConversationFixture(request, adminToken, {
        agentId,
        conversationId,
        title: 'Runs page conversation',
      });
      runId = await seedAgentRunInDb({
        tenantId,
        organizationId,
        userId,
        agentId,
        conversationId,
        toolCalls: [
          {
            toolName: 'customers.list_people',
            argKeys: ['query'],
            args: { query: 'Ada' },
            result: { total: 0 },
          },
        ],
      });

      await login(page, 'admin');
      await page.goto(RUNS_PAGE, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Agent runs' }).first()).toBeVisible({ timeout: 30_000 });

      const agentFilter = page.getByPlaceholder(AGENT_FILTER_PLACEHOLDER);
      await expect(async () => {
        await page.getByRole('button', { name: /Filters/i }).click();
        await expect(agentFilter).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await agentFilter.fill(agentId);
      const filteredResponse = page.waitForResponse(
        (response) =>
          response.url().includes('/api/ai_assistant/ai/runs?') &&
          response.url().includes(`agentId=${encodeURIComponent(agentId)}`),
      );
      await page.getByRole('button', { name: /Apply/i }).first().click();
      expect((await filteredResponse).status()).toBe(200);

      const runLink = page.getByRole('link', { name: agentId });
      await expect(runLink).toHaveCount(1, { timeout: 20_000 });
      await runLink.click();
      await page.waitForURL(new RegExp(`${RUNS_PAGE}/${runId}$`), { timeout: 20_000 });

      await expect(page.locator('[data-agent-run-detail]')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('heading', { name: agentId })).toBeVisible();
      await page.getByRole('button', { name: /Step 1/ }).click();
      await expect(page.getByText('customers.list_people').first()).toBeVisible();
      const openConversation = page.locator('[data-agent-run-open-conversation]');
      await expect(openConversation).toBeVisible();
      await expect(openConversation).toHaveAttribute(
        'href',
        `/backend?openAiConversation=${encodeURIComponent(conversationId)}`,
      );

      expect(pageErrors.filter((message) => /hydrat/i.test(message))).toEqual([]);
    } finally {
      await deleteAgentRunsInDb([runId]).catch(() => undefined);
      await deleteConversationCascadeInDb({ tenantId, conversationId }).catch(() => undefined);
    }
  });

  test('the list page renders the empty state when there are no runs', async ({ page }) => {
    await login(page, 'admin');
    await page.route('**/api/ai_assistant/ai/runs?**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 }),
      });
    });
    await page.goto(RUNS_PAGE, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('No agent runs yet.').first()).toBeVisible({ timeout: 30_000 });
  });

  test('a user without ai_assistant.runs.view is denied both pages', async ({ page, request }) => {
    const adminToken = await getAuthToken(request, 'admin');
    const { organizationId } = getTokenScope(adminToken);
    const stamp = randomUUID().slice(0, 8);
    const email = `it-runs-ui-denied-${stamp}@example.com`;
    let roleId: string | null = null;
    let userId: string | null = null;
    try {
      roleId = await createRoleFixture(request, adminToken, { name: `IT Runs UI Role ${stamp}` });
      userId = await createUserFixture(request, adminToken, {
        email,
        password: PASSWORD,
        organizationId,
        roles: [roleId],
      });
      await setUserAclVisibility(request, adminToken, {
        userId,
        features: ['ai_assistant.view'],
        organizations: [organizationId],
      });

      await loginWithCredentials(page, email, PASSWORD);
      for (const path of [RUNS_PAGE, `${RUNS_PAGE}/${randomUUID()}`]) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('Access Denied').first(), `${path} is denied`).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('[data-agent-run-detail]')).toHaveCount(0);
      }
    } finally {
      await deleteUserAclInDb(userId ?? '').catch(() => undefined);
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, roleId);
    }
  });
});
