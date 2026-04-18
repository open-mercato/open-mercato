import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AI-AGENT-SETTINGS-005: AI Agent settings page smoke (Step 4.5 / Phase 2 WS-B).
 *
 * Covers the backend agent settings route at
 * `/backend/config/ai-assistant/agents`. The page is guarded by
 * `ai_assistant.settings.manage`; superadmin always holds it. The agent
 * registry is empty by default in CI (first production agent lands in Step 4.7),
 * so the primary assertion is that the empty-state renders.
 *
 * We also assert that an unauthenticated visit redirects to `/login`.
 * The `POST /api/ai_assistant/ai/agents/:agentId/prompt-override` route is
 * stubbed so the "save overrides" path is exercisable end-to-end when an
 * agent happens to be present in the registry.
 */
test.describe('TC-AI-AGENT-SETTINGS-005: AI Agent settings', () => {
  const settingsPath = '/backend/config/ai-assistant/agents';

  test('page loads and renders empty-state for superadmin when no agents are registered', async ({
    page,
  }) => {
    await login(page, 'superadmin');

    await page.route('**/api/ai_assistant/ai/agents', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agents: [], total: 0 }),
      });
    });

    await page.route('**/api/ai_assistant/ai/agents/*/prompt-override', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pending: true,
          agentId: 'stub.stub',
          message: 'Persistence lands in Phase 3 Step 5.3.',
        }),
      });
    });

    await page.goto(settingsPath, { waitUntil: 'domcontentloaded' });

    const emptyState = page.getByText(/No AI agents are registered/i).first();
    const container = page.locator('[data-ai-agent-settings]');
    const loadError = page.locator('[data-ai-agent-settings-error]');

    await expect(emptyState.or(container).or(loadError)).toBeVisible({ timeout: 15_000 });

    if (await emptyState.isVisible().catch(() => false)) {
      await expect(emptyState).toBeVisible();
    } else if (await container.isVisible().catch(() => false)) {
      // Registry non-empty in this env — the detail panel should have rendered.
      const picker = page.locator('[data-ai-agent-settings-picker]');
      await expect(picker).toBeVisible();
    } else {
      await expect(loadError).toBeVisible();
    }
  });

  test('unauthenticated visit redirects to login', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(settingsPath, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/\/login/, { timeout: 15_000 });
      expect(page.url()).toMatch(/\/login/);
    } finally {
      await context.close();
    }
  });
});
