import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { createUserViaUi } from '../helpers/authUi';

/**
 * TC-AUTH-010: Edit Existing User
 * Source: .ai/qa/scenarios/TC-AUTH-010-user-edit.md
 */
test.describe('TC-AUTH-010: Edit Existing User', () => {
  test('should edit a user email and persist changes', async ({ page }) => {
    const stamp = Date.now();
    const initialEmail = `qa-auth-010-${stamp}@acme.com`;
    const updatedEmail = `qa-auth-010-updated-${stamp}@acme.com`;

    await login(page, 'admin');
    await createUserViaUi(page, { email: initialEmail, password: 'Valid1!Pass', role: 'employee' });

    await page.getByRole('row', { name: new RegExp(initialEmail, 'i') }).click();
    await expect(page).toHaveURL(/\/backend\/users\/[0-9a-f-]{36}\/edit$/i);

    await page.getByRole('textbox').nth(0).fill(updatedEmail);
    await page.getByRole('button', { name: 'Save' }).first().click();

    await expect(page).toHaveURL(/\/backend\/users(?:\?.*)?$/);
    await page.getByRole('textbox', { name: 'Search' }).fill(updatedEmail);
    await expect(page.getByRole('row', { name: new RegExp(updatedEmail, 'i') })).toBeVisible();
  });
});
