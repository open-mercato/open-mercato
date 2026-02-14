import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { createUserViaUi } from '../helpers/authUi';

/**
 * TC-AUTH-008: Admin Creates New User
 * Source: .ai/qa/scenarios/TC-AUTH-008-user-creation.md
 */
test.describe('TC-AUTH-008: Admin Creates New User', () => {
  test('should create a new user from the create form', async ({ page }) => {
    const email = `qa-auth-008-${Date.now()}@acme.com`;
    await login(page, 'admin');
    await createUserViaUi(page, { email, password: 'Valid1!Pass', role: 'employee' });
    await expect(page.getByText(email)).toBeVisible();
  });
});
