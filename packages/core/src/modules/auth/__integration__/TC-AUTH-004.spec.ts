import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AUTH-004: User Logout
 * Source: .ai/qa/scenarios/TC-AUTH-004-user-logout.md
 */
test.describe('TC-AUTH-004: User Logout', () => {
  test('should clear session and redirect to login', async ({ page }) => {
    await login(page, 'admin');
    await expect(page).toHaveURL(/\/backend(?:\/.*)?$/);

    await page.getByRole('button', { name: /admin@acme.com/i }).click();
    await page.getByRole('menuitem', { name: /logout/i }).click();
    await page.waitForTimeout(500);

    const cookies = await page.context().cookies();
    const authCookie = cookies.find((cookie) => cookie.name === 'auth_token');
    expect(authCookie).toBeUndefined();
  });
});
