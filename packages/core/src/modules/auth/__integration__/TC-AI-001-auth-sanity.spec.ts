import { test, expect } from '@playwright/test';
import { login, DEFAULT_CREDENTIALS } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AI-001: Auth sanity for the AI framework integration run (Step 3.13 / Phase 3 WS-C).
 *
 * The checkpoint browser smoke at ${run_folder}/checkpoint-phase3-wsc.md covered
 * superadmin login via `/login?redirect=%2Fbackend` and landing on `/backend`.
 * This test re-records that path plus the negative (wrong password) path so the
 * Phase 1 WS-C integration suite has a baseline smoke that the backend shell is
 * reachable before exercising the AI dispatcher.
 *
 * Credentials MUST come from `DEFAULT_CREDENTIALS.superadmin` via the shared
 * helper — never inline the password.
 */
test.describe('TC-AI-001: AI framework auth sanity', () => {
  test('superadmin login reaches /backend', async ({ page }) => {
    await login(page, 'superadmin');
    await expect(page).toHaveURL(/\/backend(?:\/.*)?$/);
  });

  test('wrong password stays on /login and surfaces an error', async ({ page }) => {
    // Give this test more time — dev cold-compile of `/login` + `/api/auth/login`
    // on first hit can exceed the 20s default; 60s covers both.
    test.setTimeout(60_000);

    const superadmin = DEFAULT_CREDENTIALS.superadmin;

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    // MUST wait for hydration — the submit handler early-returns until
    // `clientReady` flips true, which matches `data-auth-ready="1"` on the form.
    await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 });

    const emailInput = page.getByLabel('Email');
    await expect(emailInput).toBeVisible();
    await emailInput.fill(superadmin.email);

    const passwordInput = page.getByLabel('Password', { exact: true }).first();
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill('this-password-is-intentionally-wrong');

    // Submit via the form's native submit to bypass bottom-banner pointer
    // interception; the onSubmit handler reads credentials from FormData.
    const [loginResponse] = await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes('/api/auth/login') && response.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      page.locator('form[data-auth-ready="1"]').evaluate((form) => {
        (form as HTMLFormElement).requestSubmit();
      }),
    ]);

    expect(loginResponse.status()).toBeGreaterThanOrEqual(400);

    // Stay on /login — the login POST must not redirect to /backend with bad creds.
    await expect
      .poll(() => page.url(), { timeout: 10_000 })
      .toMatch(/\/login(?:\?.*)?$/);
  });
});
