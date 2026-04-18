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
    const superadmin = DEFAULT_CREDENTIALS.superadmin;

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 5_000 }).catch(() => null);

    const emailInput = page.getByLabel('Email');
    await expect(emailInput).toBeVisible();
    await emailInput.fill(superadmin.email);

    const passwordInput = page.getByLabel('Password').first();
    await expect(passwordInput).toBeVisible();
    await passwordInput.fill('this-password-is-intentionally-wrong');

    const submitButton = page.getByRole('button', { name: /login|sign in|continue with sso/i }).first();
    await submitButton.click();

    // Stay on /login — the login POST must not redirect to /backend with bad creds.
    await expect
      .poll(() => page.url(), { timeout: 5_000 })
      .toMatch(/\/login(?:\?.*)?$/);

    // The auth module surfaces a visible error alert (Alert component or a
    // role=alert region). Accept either the semantic role or common error text.
    const errorAlert = page.getByRole('alert').first();
    const errorText = page.getByText(/invalid|incorrect|wrong|failed|unauthor/i).first();
    await expect(errorAlert.or(errorText)).toBeVisible({ timeout: 5_000 });
  });
});
