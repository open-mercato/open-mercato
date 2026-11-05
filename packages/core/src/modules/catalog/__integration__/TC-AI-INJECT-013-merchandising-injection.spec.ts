import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AI-INJECT-013: Catalog merchandising AiChat via widget injection
 * (Phase 3 WS-D, Step 5.15).
 *
 * Verifies the merchandising assistant trigger now mounts through the
 * injection registry (`catalog.injection.merchandising-assistant-trigger`
 * on `data-table:catalog.products:header`) rather than being imported
 * directly by the products list page.
 *
 * Delta vs TC-AI-MERCHANDISING-008:
 *  - TC-AI-MERCHANDISING-008 exercised the trigger when it was wired
 *    page-side via `extraActions`. This spec proves the SAME DOM contract
 *    still holds after the migration to the injection path — so the
 *    legacy spec continues to pass unchanged and third-party modules can
 *    copy the new pattern confidently.
 */
test.describe('TC-AI-INJECT-013: catalog merchandising via injection', () => {
  const MERCHANDISING_AGENT_ID = 'catalog.merchandising_assistant';

  test('merchandising trigger renders from the injection registry on products list', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 });
    await login(page, 'superadmin');
    await page.goto('/backend/catalog/products', { waitUntil: 'domcontentloaded' });

    const trigger = page.locator('[data-ai-merchandising-trigger]').first();
    await expect(trigger).toBeVisible({ timeout: 60_000 });
  });

  test('clicking the trigger opens the sheet with the AiChat composer wired to the merchandising agent', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 });
    await login(page, 'superadmin');
    await page.goto('/backend/catalog/products', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('backend-chrome-ready')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });

    const trigger = page.locator('[data-ai-merchandising-trigger]').first();
    await expect(trigger).toBeVisible({ timeout: 60_000 });
    await expect(trigger).toBeEnabled({ timeout: 30_000 });

    // Single-agent module → the trigger opens the sheet directly. The
    // split-button caret + agent-picker popover only render when the
    // widget exposes more than one assistant.
    const sheet = page.locator('[data-ai-merchandising-sheet]');
    const chatRegion = sheet.locator(`[data-ai-chat-agent="${MERCHANDISING_AGENT_ID}"]`);
    const composer = chatRegion.locator('#ai-chat-composer');
    // The trigger is server-rendered and can be visible+enabled before React
    // binds its onClick handler, so under heavy CI load a single click is a
    // no-op and the sheet never opens. Re-click (only while the sheet is
    // closed) until the sheet + composer mount.
    await expect(async () => {
      if (!(await sheet.isVisible())) await trigger.click();
      await expect(sheet).toBeVisible({ timeout: 3_000 });
      await expect(chatRegion).toBeVisible({ timeout: 3_000 });
      await expect(composer).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 60_000, intervals: [500, 1_000, 2_000] });
  });
});
