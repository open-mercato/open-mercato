import { expect, test } from '@playwright/test';

/**
 * TC-AUTH-006: Complete Password Reset
 * Source: .ai/qa/scenarios/TC-AUTH-006-password-reset-complete.md
 */
test.describe('TC-AUTH-006: Complete Password Reset', () => {
  test('should show reset form and reject completion with an invalid token', async ({ page }) => {
    await page.goto('/reset/qa-invalid-token');
    await expect(page.getByText(/set a new password/i)).toBeVisible();

    await page.getByLabel(/new password/i).fill('Valid1!Pass');
    await page.getByRole('button', { name: /update password/i }).click();

    await expect(page.getByText(/invalid or expired token/i)).toBeVisible();
  });
});
