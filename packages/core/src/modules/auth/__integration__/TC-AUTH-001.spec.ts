import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-AUTH-001: Successful User Login
 * Source: .ai/qa/scenarios/TC-AUTH-001-user-login-success.md
 */
test.describe('TC-AUTH-001: Successful User Login', () => {
  test('should login with valid credentials and redirect to dashboard', async ({ page }) => {
    await login(page, 'admin');
    await expect(page).toHaveURL(/\/backend/);
  });
});
