import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-AUTH-012: Create New Role
 * Source: .ai/qa/scenarios/TC-AUTH-012-role-creation.md
 */
test.describe('TC-AUTH-012: Create New Role', () => {
  test('should create a role and show it in roles list', async ({ page, request }) => {
    const roleName = `qa-auth-role-${Date.now()}`;
    let token: string | null = null;
    let roleId: string | null = null;

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');
      await page.goto('/backend/roles/create');
      await expect(page.getByText('Create Role')).toBeVisible();

      await page.getByRole('textbox').first().fill(roleName);
      await page.getByRole('button', { name: 'Create' }).first().click();

      await expect(page).toHaveURL(/\/backend\/roles(?:\?.*)?$/);
      await page.getByRole('textbox', { name: 'Search' }).fill(roleName);
      await expect(page.getByRole('row', { name: new RegExp(roleName, 'i') })).toBeVisible();
      await page.getByRole('row', { name: new RegExp(roleName, 'i') }).click();
      await expect(page).toHaveURL(/\/backend\/roles\/[0-9a-f-]{36}\/edit$/i);
      roleId = page.url().match(/\/backend\/roles\/([0-9a-f-]{36})\/edit$/i)?.[1] ?? null;
    } finally {
      if (token && roleId) {
        await apiRequest(request, 'DELETE', `/api/auth/roles?id=${encodeURIComponent(roleId)}`, { token }).catch(() => {});
      }
    }
  });
});
