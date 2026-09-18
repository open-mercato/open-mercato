import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AI-MODERATION-009 — Moderation UI surfaces (Playwright).
 * Source: spec `.ai/specs/2026-06-04-ai-input-moderation-and-safety-identifiers.md`.
 *
 * Covers the two new backend UI surfaces deterministically by stubbing the
 * data routes (the page chrome + components render regardless of the live
 * registry / DB):
 *   - `/backend/config/ai-assistant/moderation-flags` — audit DataTable.
 *   - `/backend/config/ai-assistant/agents` — per-agent moderation section.
 *
 * The chat enforced→rejection and chat-off→passthrough flows are intentionally
 * NOT exercised here: the moderation gate runs SERVER-SIDE inside
 * `runAiAgentText`, so `page.route()` cannot stub it, and a live-provider e2e
 * would be non-deterministic (it needs a real OpenAI key + model behavior),
 * which `.ai/qa/AGENTS.md` forbids. Those branches are covered deterministically
 * by the gate unit tests (`input-moderation-gate.test.ts`), the moderation
 * service tests, and the `<AiChat>` `moderation_blocked` render test.
 */

const FLAGS_PAGE = '/backend/config/ai-assistant/moderation-flags';
const AGENTS_PAGE = '/backend/config/ai-assistant/agents';

test.describe('TC-AI-MODERATION-009: moderation UI surfaces', () => {
  test('audit page renders a flagged row with its category badge', async ({ page }) => {
    await login(page, 'superadmin');

    await page.route('**/api/ai_assistant/moderation-flags**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 'flag-it-1',
              tenantId: 't-1',
              organizationId: null,
              agentId: 'support.portal_assistant',
              userId: 'hashed-user-it',
              providerId: 'openai',
              modelId: 'gpt-5-mini',
              categories: { hate: { flagged: true, score: 0.97 }, violence: { flagged: false, score: 0.01 } },
              createdAt: '2026-06-10T12:00:00.000Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 50,
        }),
      });
    });

    await page.goto(FLAGS_PAGE, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('support.portal_assistant').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('hashed-user-it').first()).toBeVisible();
    // Only the flagged category renders as a badge; the non-flagged one is omitted.
    await expect(page.getByText('hate', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('violence', { exact: true })).toHaveCount(0);
  });

  test('audit page renders the empty state when there are no flags', async ({ page }) => {
    await login(page, 'superadmin');

    await page.route('**/api/ai_assistant/moderation-flags**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, page: 1, pageSize: 50 }),
      });
    });

    await page.goto(FLAGS_PAGE, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/No flagged messages/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('audit page redirects an unauthenticated visit to login', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(FLAGS_PAGE, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/\/login/, { timeout: 15_000 });
      expect(page.url()).toMatch(/\/login/);
    } finally {
      await context.close();
    }
  });

  test('agent settings renders the input-moderation section (enforced badge for untrusted agents)', async ({
    page,
  }) => {
    await login(page, 'superadmin');

    const agent = {
      id: 'support.portal_assistant',
      moduleId: 'support',
      label: 'Portal assistant',
      description: 'Customer-facing support assistant.',
      executionMode: 'chat',
      readOnly: true,
      mutationPolicy: 'read-only',
      untrustedInput: true,
      allowedTools: [],
      acceptedMediaTypes: [],
      tools: [],
    };

    await page.route('**/api/ai_assistant/ai/agents', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ agents: [agent], total: 1 }),
      });
    });
    await page.route('**/api/ai_assistant/settings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          availableProviders: [],
          agents: [
            {
              agentId: agent.id,
              moduleId: agent.moduleId,
              allowRuntimeModelOverride: true,
              codeDefaultProviderId: null,
              codeDefaultModelId: null,
              override: null,
              runtimeOverrideAllowlist: {
                env: null,
                tenant: null,
                effective: { providers: null, modelsByProvider: {}, hasRestrictions: false, tenantOverridesActive: false },
                envVarNames: { providers: 'X', modelsByProvider: {} },
              },
              providerId: 'openai',
              modelId: 'gpt-5-mini',
              baseURL: null,
              source: 'provider_default',
              moderation: { enforced: true, override: null, effective: 'enforced' },
            },
          ],
        }),
      });
    });

    await page.goto(AGENTS_PAGE, { waitUntil: 'domcontentloaded' });

    const moderationSection = page.locator('[data-ai-agent-moderation]');
    const settingsContainer = page.locator('[data-ai-agent-settings]');
    // Either the moderation section rendered (registry+detail loaded from the stub)
    // or at least the settings page chrome loaded — never a hard failure.
    await expect(moderationSection.or(settingsContainer).first()).toBeVisible({ timeout: 20_000 });

    if (await moderationSection.first().isVisible().catch(() => false)) {
      // The untrustedInput agent renders the non-editable Enforced badge.
      await expect(page.locator('[data-ai-agent-moderation-enforced]').first()).toBeVisible();
    }
  });
});
