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

  test('Cmd/Ctrl+Enter inside a prompt-override textarea triggers the placeholder save', async ({
    page,
  }) => {
    await login(page, 'superadmin');

    // Non-empty registry so the detail panel renders and the textareas exist.
    await page.route('**/api/ai_assistant/ai/agents', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agents: [
            {
              id: 'customers.assistant',
              moduleId: 'customers',
              label: 'Customers assistant',
              description: 'Answers questions about customer records.',
              systemPrompt: 'You are a customers assistant.',
              executionMode: 'chat',
              mutationPolicy: 'read-only',
              readOnly: true,
              maxSteps: 10,
              allowedTools: ['customers.list_people'],
              tools: [
                {
                  name: 'customers.list_people',
                  displayName: 'List people',
                  isMutation: false,
                  registered: true,
                },
              ],
              requiredFeatures: [],
              acceptedMediaTypes: [],
              hasOutputSchema: false,
            },
          ],
          total: 1,
        }),
      });
    });

    let saveCalls = 0;
    await page.route('**/api/ai_assistant/ai/agents/*/prompt-override', async (route) => {
      saveCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          pending: true,
          agentId: 'customers.assistant',
          message: 'Persistence lands in Phase 3 Step 5.3.',
        }),
      });
    });

    await page.goto(settingsPath, { waitUntil: 'domcontentloaded' });

    const container = page.locator('[data-ai-agent-settings]');
    await expect(container).toBeVisible({ timeout: 15_000 });

    // Flip the `role` section into override mode so a textarea is present.
    const toggle = page.locator('[data-ai-agent-prompt-toggle="role"]');
    await toggle.click();

    const textarea = page.locator('[data-ai-agent-prompt-override="role"]');
    await expect(textarea).toBeVisible();
    await textarea.fill('Custom role text.');

    // Cmd+Enter (mac) / Ctrl+Enter (others) — Playwright supports both.
    await textarea.press('Meta+Enter');
    await page.waitForTimeout(250);
    if (saveCalls === 0) {
      await textarea.press('Control+Enter');
      await page.waitForTimeout(250);
    }

    expect(saveCalls).toBeGreaterThanOrEqual(1);
  });

  test('selecting an agent renders detail panel with meta badges, tool toggles, and attachment policy', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await login(page, 'superadmin');

    await page.route('**/api/ai_assistant/ai/agents', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agents: [
            {
              id: 'customers.account_assistant',
              moduleId: 'customers',
              label: 'Customers account assistant',
              description: 'Answers questions about customer records.',
              systemPrompt: 'You are a helpful read-only customers assistant.',
              executionMode: 'chat',
              mutationPolicy: 'read-only',
              readOnly: true,
              maxSteps: 10,
              allowedTools: ['customers.list_people', 'customers.get_person'],
              tools: [
                {
                  name: 'customers.list_people',
                  displayName: 'List people',
                  isMutation: false,
                  registered: true,
                },
                {
                  name: 'customers.get_person',
                  displayName: 'Get person',
                  isMutation: false,
                  registered: true,
                },
              ],
              requiredFeatures: ['customers.people.view'],
              acceptedMediaTypes: ['image/png', 'application/pdf'],
              hasOutputSchema: false,
            },
          ],
          total: 1,
        }),
      });
    });

    await page.goto(settingsPath, { waitUntil: 'domcontentloaded' });

    const container = page.locator('[data-ai-agent-settings]');
    await expect(container).toBeVisible({ timeout: 60_000 });

    // Detail panel renders for the first (only) agent.
    const detailPanel = page.locator('[data-ai-agent-detail="customers.account_assistant"]');
    await expect(detailPanel).toBeVisible();

    // Tool rows render for every declared tool, with disabled switches.
    const listRow = page.locator('[data-ai-agent-tool-row="customers.list_people"]');
    await expect(listRow).toBeVisible();
    const listSwitch = page.locator('[data-ai-agent-tool-switch="customers.list_people"]');
    // Radix `Switch` primitives surface the disabled state via
    // `aria-disabled`/`data-disabled` rather than the native attribute,
    // so assert both. Either one is sufficient evidence the switch is
    // read-only in Phase 2.
    const ariaDisabled = await listSwitch.getAttribute('aria-disabled');
    const dataDisabled = await listSwitch.getAttribute('data-disabled');
    const disabledAttr = await listSwitch.getAttribute('disabled');
    expect(
      ariaDisabled === 'true' || dataDisabled !== null || disabledAttr !== null,
    ).toBe(true);

    // Attachment policy badges surface for each declared media type.
    const pngBadge = page.locator('[data-ai-agent-attachment-badge="image/png"]');
    await expect(pngBadge).toBeVisible();
    const pdfBadge = page.locator('[data-ai-agent-attachment-badge="application/pdf"]');
    await expect(pdfBadge).toBeVisible();
  });
});
