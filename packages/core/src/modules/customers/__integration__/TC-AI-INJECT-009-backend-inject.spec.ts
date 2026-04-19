import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AI-INJECT-009: Backend AiChat injection example (Phase 2 WS-C, Step 4.10).
 *
 * Asserts the `customers.injection.ai-assistant-trigger` widget injects
 * an "Ask AI" trigger into the People list DataTable header WITHOUT
 * editing the page, and opens a sheet embedding `<AiChat>` wired to
 * `customers.account_assistant`.
 */
test.describe('TC-AI-INJECT-009: backend AiChat injection', () => {
  test('people list header shows the injected AI trigger for superadmin', async ({ page }) => {
    // Cold-compile of /login + /backend/customers/people can take a
    // while on first dev-server hit; give the whole test 2 minutes.
    test.setTimeout(120_000);

    // Prime /login so the cold compile finishes before the helper's
    // 3s-per-attempt ready-selector wait kicks in.
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 });

    await login(page, 'superadmin');
    await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });

    const trigger = page.locator('[data-ai-customers-inject-trigger]').first();
    await expect(trigger).toBeVisible({ timeout: 60_000 });
  });
});
