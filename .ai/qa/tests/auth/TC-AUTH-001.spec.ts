import { test, expect } from '@playwright/test';

/**
 * TC-AUTH-001: Successful User Login
 * Source: .ai/qa/TC-AUTH-001-user-login-success.md
 */
test.describe('TC-AUTH-001: Successful User Login', () => {
  test('should login with valid credentials and redirect to dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();

    await page.getByLabel('Email').fill('admin@acme.com');
    await page.getByLabel('Password').fill('secret');
    await page.getByRole('button', { name: /login|sign in/i }).click();

    await page.waitForURL('**/backend/**');
    await expect(page).toHaveURL(/\/backend/);
  });
});
