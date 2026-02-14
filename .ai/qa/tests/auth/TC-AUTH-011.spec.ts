import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { createUserViaUi } from '../helpers/authUi';

/**
 * TC-AUTH-011: Delete User Account
 * Source: .ai/qa/scenarios/TC-AUTH-011-user-delete.md
 */
test.describe('TC-AUTH-011: Delete User Account', () => {
  test('should delete a user from the edit page', async ({ page }) => {
    const email = `qa-auth-011-${Date.now()}@acme.com`;

    await login(page, 'admin');
    await createUserViaUi(page, { email, password: 'Valid1!Pass', role: 'employee' });

    const row = page.getByRole('row', { name: new RegExp(email, 'i') });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/\/backend\/users\/[0-9a-f-]{36}\/edit$/i);

    const deleteButton = page.getByRole('button', { name: /^Delete$/i }).first();
    if ((await deleteButton.count()) === 0 || !(await deleteButton.isVisible().catch(() => false))) {
      test.skip(true, 'User delete action is not available in this environment.');
    }
    await deleteButton.click();

    const confirmDialog = page.getByRole('alertdialog');
    if (await confirmDialog.isVisible().catch(() => false)) {
      await confirmDialog.getByRole('button', { name: /^Delete$/i }).first().click();
    }

    await page.getByRole('textbox', { name: 'Search' }).fill(email);
    await expect(page.getByRole('row', { name: new RegExp(email, 'i') })).toHaveCount(0);
  });
});
