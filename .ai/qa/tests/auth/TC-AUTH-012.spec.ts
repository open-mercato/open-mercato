import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-AUTH-012: Create New Role
 * Source: .ai/qa/scenarios/TC-AUTH-012-role-creation.md
 */
test.describe('TC-AUTH-012: Create New Role', () => {
  test('should create a role and show it in roles list', async ({ page }) => {
    const roleName = `qa-auth-role-${Date.now()}`;

    await login(page, 'admin');
    await page.goto('/backend/roles/create');
    await expect(page.getByText('Create Role')).toBeVisible();

    await page.getByRole('textbox').first().fill(roleName);
    await page.getByRole('button', { name: 'Create' }).first().click();

    await expect(page).toHaveURL(/\/backend\/roles(?:\?.*)?$/);
    await page.getByRole('textbox', { name: 'Search' }).fill(roleName);
    await expect(page.getByRole('row', { name: new RegExp(roleName, 'i') })).toBeVisible();
  });
});
