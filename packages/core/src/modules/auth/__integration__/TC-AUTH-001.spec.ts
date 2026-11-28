import { test, expect } from '@playwright/test';
import { DEFAULT_CREDENTIALS, login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AUTH-001: Successful User Login
 * Source: .ai/qa/scenarios/TC-AUTH-001-user-login-success.md
 */
test.describe('TC-AUTH-001: Successful User Login', () => {
  test('should login with valid credentials and redirect to dashboard', async ({ page }) => {
    await login(page, 'admin');
    await expect(page).toHaveURL(/\/backend/);
    const dashboardHeading = page.getByRole('heading', { name: /^Good (morning|afternoon|evening), /, level: 1 });
    await expect(dashboardHeading).toBeVisible();
    await expect(dashboardHeading).toContainText(DEFAULT_CREDENTIALS.admin.email);
    await expect(page.locator('main h1')).toHaveCount(1);
  });
});
