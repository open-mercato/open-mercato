import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-AUTH-013: Configure Role ACL and Permissions
 * Source: .ai/qa/scenarios/TC-AUTH-013-role-acl-configuration.md
 */
test.describe('TC-AUTH-013: Configure Role ACL and Permissions', () => {
  test('should persist ACL checkbox changes for a role', async ({ page, request }) => {
    const roleName = `qa-auth-acl-${Date.now()}`;
    let token: string | null = null;
    let roleId: string | null = null;

    try {
      token = await getAuthToken(request);
      await login(page, 'admin');
      await page.goto('/backend/roles/create');
      await page.getByRole('textbox').first().fill(roleName);
      await page.getByRole('button', { name: 'Create' }).first().click();
      await expect(page).toHaveURL(/\/backend\/roles(?:\?.*)?$/);

      await page.getByRole('textbox', { name: 'Search' }).fill(roleName);
      await page.getByRole('row', { name: new RegExp(roleName, 'i') }).click();
      await expect(page).toHaveURL(/\/backend\/roles\/[0-9a-f-]{36}\/edit$/i);
      roleId = page.url().match(/\/backend\/roles\/([0-9a-f-]{36})\/edit$/i)?.[1] ?? null;

      const featureCheckbox = page.getByRole('checkbox', { name: /view api keys \(api_keys\.view\)/i }).first();
      if ((await featureCheckbox.count()) === 0 || !(await featureCheckbox.isVisible().catch(() => false))) {
        test.skip(true, 'Target ACL checkbox is not visible for this role.');
      }
      if (!(await featureCheckbox.isChecked())) {
        await featureCheckbox.check();
      }
      await expect(featureCheckbox).toBeChecked();
      await page.getByRole('button', { name: 'Save' }).first().click();

      await expect(page).toHaveURL(/\/backend\/roles(?:\?.*)?$/);
      await page.getByRole('textbox', { name: 'Search' }).fill(roleName);
      await page.getByRole('row', { name: new RegExp(roleName, 'i') }).click();
      await expect(featureCheckbox).toBeChecked();
    } finally {
      if (token && roleId) {
        await apiRequest(request, 'DELETE', `/api/auth/roles?id=${encodeURIComponent(roleId)}`, { token }).catch(() => {});
      }
    }
  });
});
