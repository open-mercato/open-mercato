import { expect, test } from '@playwright/test';

/**
 * TC-AUTH-003: Login with Remember Me
 * Source: .ai/qa/scenarios/TC-AUTH-003-user-login-remember-me.md
 */
test.describe('TC-AUTH-003: Login with Remember Me', () => {
  test('should set both auth and session cookies when remember me is enabled', async ({ page }) => {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    await page.context().addCookies([
      { name: 'om_demo_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
      { name: 'om_cookie_notice_ack', value: 'ack', url: baseUrl, sameSite: 'Lax' },
    ]);

    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@acme.com');
    await page.getByLabel('Password').fill('secret');
    await page.getByRole('checkbox', { name: /remember me/i }).check();
    await page.getByLabel('Password').press('Enter');

    await expect(page).toHaveURL(/\/backend(?:\/.*)?$/);

    const cookies = await page.context().cookies();
    const names = new Set(cookies.map((cookie) => cookie.name));
    expect(names.has('auth_token')).toBeTruthy();
    expect(names.has('session_token')).toBeTruthy();
  });
});
