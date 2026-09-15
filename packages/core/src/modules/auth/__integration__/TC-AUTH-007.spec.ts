import { expect, test, type Page } from '@playwright/test';

/**
 * The reset page checks the token against /api/auth/reset/validate as soon as it
 * hydrates, so a dead link never renders the password form (issue #5533). Gate
 * the assertion on that POST: it can only fire from the hydrated client
 * component, which both proves hydration completed and serializes the assertion
 * behind the deterministic round-trip.
 */
async function expectTerminalStateForDeadToken(page: Page, token: string): Promise<void> {
  const validateResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/reset/validate') &&
      response.request().method() === 'POST',
  );
  await page.goto(`/reset/${token}`);
  await validateResponse;

  await expect(page.locator('[data-auth-token-state="expired"]')).toBeVisible();
  await expect(page.getByText(/this reset link is no longer valid/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /request a new link/i })).toBeVisible();
  await expect(page.getByLabel(/^new password$/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /update password/i })).toHaveCount(0);
}

/**
 * TC-AUTH-007: Password Reset with Expired Token
 * Source: .ai/qa/scenarios/TC-AUTH-007-password-reset-expired-token.md
 */
test.describe('TC-AUTH-007: Password Reset with Expired Token', () => {
  test('should reject invalid and expired reset tokens before rendering the form', async ({ page }) => {
    await expectTerminalStateForDeadToken(page, 'qa-expired-token');
    await expectTerminalStateForDeadToken(page, 'qa-malformed-token');
  });

  test('should send the user back to the request form from the terminal state', async ({ page }) => {
    const validateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/auth/reset/validate') &&
        response.request().method() === 'POST',
    );
    await page.goto('/reset/qa-expired-token');
    await validateResponse;

    await page.getByRole('link', { name: /request a new link/i }).click();
    await expect(page).toHaveURL(/\/reset$/);
  });
});
