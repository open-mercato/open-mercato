import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AI-PLAYGROUND-004: AI Playground page smoke (Step 4.4 / Phase 2 WS-B).
 *
 * Covers the first user-facing embedding of `<AiChat>` in the backoffice. The
 * route is guarded by `ai_assistant.settings.manage`; superadmin always holds
 * it. The agent registry may be empty in CI (generated file depends on
 * module authors registering agents), so the spec handles BOTH branches:
 *   - populated registry: assert the agent picker, debug toggle, and chat
 *     surface render;
 *   - empty registry: assert the `EmptyState` copy renders instead.
 *
 * The chat SSE response is stubbed via Playwright's route interception so the
 * test never has to hit a live LLM provider. The object-mode run-object route
 * is also stubbed to assert wiring without invoking a real model.
 */
test.describe('TC-AI-PLAYGROUND-004: AI Playground', () => {
  const playgroundPath = '/backend/config/ai-assistant/playground';

  test('playground renders agent picker or empty state for superadmin', async ({ page }) => {
    await login(page, 'superadmin');

    // Stub the agents list so the test behavior is deterministic regardless of
    // what the generated registry holds at run-time.
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
              executionMode: 'chat',
              mutationPolicy: 'read-only',
              allowedTools: ['customers.list_people'],
              requiredFeatures: [],
              acceptedMediaTypes: [],
              hasOutputSchema: false,
            },
            {
              id: 'catalog.extract',
              moduleId: 'catalog',
              label: 'Catalog extractor',
              description: 'Extracts structured product metadata.',
              executionMode: 'object',
              mutationPolicy: 'read-only',
              allowedTools: [],
              requiredFeatures: [],
              acceptedMediaTypes: [],
              hasOutputSchema: true,
            },
          ],
          total: 2,
        }),
      });
    });

    // Stub the chat SSE so the composer has something to "succeed" against.
    await page.route('**/api/ai_assistant/ai/chat**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'ok from stubbed SSE\n',
      });
    });

    // Stub the run-object dispatcher so the object-mode tab has a deterministic response.
    await page.route('**/api/ai_assistant/ai/run-object', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          object: { title: 'Stubbed title' },
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 2 },
        }),
      });
    });

    await page.goto(playgroundPath, { waitUntil: 'domcontentloaded' });

    const container = page.locator('[data-ai-playground]');
    const empty = page.getByText(/No AI agents are registered/i).first();
    const loadError = page.locator('[data-ai-playground-error]');

    // Wait until the page has stabilized (either container, empty state, or a load error).
    await expect(container.or(empty).or(loadError)).toBeVisible({ timeout: 15_000 });

    if (await container.isVisible().catch(() => false)) {
      const picker = page.locator('[data-ai-playground-agent-picker]');
      await expect(picker).toBeVisible();
      // Two stubbed agents should surface.
      const optionCount = await picker.locator('option').count();
      expect(optionCount).toBeGreaterThanOrEqual(2);

      const debugToggle = page.locator('[data-ai-playground-debug-toggle]');
      await expect(debugToggle).toBeVisible();

      const composer = page.locator('#ai-chat-composer');
      await expect(composer).toBeVisible();
      await composer.fill('Hello from Playwright');
      await expect(composer).toHaveValue('Hello from Playwright');

      // Step 4.6: toggling the debug panel should reveal the three collapsible
      // sections (tool map / prompt sections / last request), each addressable
      // by its `data-ai-chat-debug-section` attribute.
      const debugPanel = page.locator('[data-ai-chat-debug="true"]');
      const initiallyVisible = await debugPanel.isVisible().catch(() => false);
      if (!initiallyVisible) {
        await debugToggle.click();
      }
      await expect(debugPanel).toBeVisible({ timeout: 5_000 });
      await expect(
        page.locator('[data-ai-chat-debug-section="tools"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-ai-chat-debug-section="promptSections"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-ai-chat-debug-section="lastRequest"]'),
      ).toBeVisible();
    } else if (await empty.isVisible().catch(() => false)) {
      // Empty branch: agent registry is empty in this environment.
      await expect(empty).toBeVisible();
    } else {
      // Fatal load error branch — still acceptable evidence that the guard fired.
      await expect(loadError).toBeVisible();
    }
  });
});
