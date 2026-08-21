import { expect, test, type Page } from '@playwright/test';

/**
 * The reset page is a client component whose submit handler (which calls
 * `preventDefault` and POSTs to /api/auth/reset/confirm) only exists once React
 * hydrates. Clicking the server-rendered submit button before hydration triggers
 * a native form submission that navigates away and never renders the error, so
 * gate the assertion on the confirm POST: it can only fire from the hydrated JS
 * handler, which both proves hydration completed and serializes the assertion
 * behind the deterministic round-trip.
 */
async function submitResetAndExpectError(page: Page): Promise<void> {
  await page.waitForSelector('form[data-auth-ready="1"]', { state: 'visible', timeout: 30_000 });
  const passwordInput = page.getByLabel(/^new password$/i);
  const confirmPasswordInput = page.getByLabel(/^confirm new password$/i);
  await passwordInput.fill('Valid1!Pass');
  await expect(passwordInput).toHaveValue('Valid1!Pass');
  await confirmPasswordInput.fill('Valid1!Pass');
  await expect(confirmPasswordInput).toHaveValue('Valid1!Pass');
  const confirmResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/reset/confirm') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /update password/i }).click();
  await confirmResponse;
  await expect(page.getByText(/invalid or expired token/i)).toBeVisible();
}

/**
 * TC-AUTH-007: Password Reset with Expired Token
 * Source: .ai/qa/scenarios/TC-AUTH-007-password-reset-expired-token.md
 */
test.describe('TC-AUTH-007: Password Reset with Expired Token', () => {
  test('should reject invalid and expired reset tokens', async ({ page }) => {
    await page.goto('/reset/qa-expired-token');
    await submitResetAndExpectError(page);

    await page.goto('/reset/qa-malformed-token');
    await submitResetAndExpectError(page);
  });
});
