import { expect, test } from '@playwright/test';

/**
 * TC-AUTH-007: Password Reset with Expired Token
 * Source: .ai/qa/scenarios/TC-AUTH-007-password-reset-expired-token.md
 */
test.describe('TC-AUTH-007: Password Reset with Expired Token', () => {
  test('should reject invalid and expired reset tokens', async ({ page }) => {
    await page.goto('/reset/qa-expired-token');
    await page.getByLabel(/new password/i).fill('Valid1!Pass');
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText(/invalid or expired token/i)).toBeVisible();

    await page.goto('/reset/qa-malformed-token');
    await page.getByLabel(/new password/i).fill('Valid1!Pass');
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText(/invalid or expired token/i)).toBeVisible();
  });
});
