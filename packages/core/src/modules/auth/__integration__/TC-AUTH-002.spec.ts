import { expect, test } from '@playwright/test';

/**
 * TC-AUTH-002: Login Failure with Invalid Credentials
 * Source: .ai/qa/scenarios/TC-AUTH-002-user-login-invalid-credentials.md
 */
test.describe('TC-AUTH-002: Login Failure with Invalid Credentials', () => {
  test('should reject invalid credentials with a generic error', async ({ page }) => {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    await page.context().addCookies([
      { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
      { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    ]);

    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@acme.com');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByLabel('Password').press('Enter');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/invalid email or password|invalid credentials/i).first()).toBeVisible();

    await page.getByLabel('Email').fill(`not-found-${Date.now()}@acme.com`);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByLabel('Password').press('Enter');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/invalid email or password|invalid credentials/i).first()).toBeVisible();
  });
});
