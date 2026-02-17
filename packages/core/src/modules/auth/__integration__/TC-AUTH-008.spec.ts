import { expect, test } from '@playwright/test';
import { login } from '../../core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '../../core/__integration__/helpers/api';
import { createUserViaUi } from '../../core/__integration__/helpers/authUi';

/**
 * TC-AUTH-008: Admin Creates New User
 * Source: .ai/qa/scenarios/TC-AUTH-008-user-creation.md
 */
test.describe('TC-AUTH-008: Admin Creates New User', () => {
  test('should create a new user from the create form', async ({ page, request }) => {
    const email = `qa-auth-008-${Date.now()}@acme.com`;
    let token: string | null = null;
    let userId: string | null = null;

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');
      await createUserViaUi(page, { email, password: 'Valid1!Pass', role: 'employee' });
      await expect(page.getByText(email)).toBeVisible();

      await page.getByRole('row', { name: new RegExp(email, 'i') }).click();
      await expect(page).toHaveURL(/\/backend\/users\/[0-9a-f-]{36}\/edit$/i);
      userId = page.url().match(/\/backend\/users\/([0-9a-f-]{36})\/edit$/i)?.[1] ?? null;
    } finally {
      if (token && userId) {
        await apiRequest(request, 'DELETE', `/api/auth/users?id=${encodeURIComponent(userId)}`, { token }).catch(() => {});
      }
    }
  });
});
