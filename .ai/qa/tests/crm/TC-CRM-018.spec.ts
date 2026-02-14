import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CRM-018: Person Display Name Edit And Undo
 */
test.describe('TC-CRM-018: Person Display Name Edit And Undo', () => {
  test('should edit person display name and undo the update', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/people/29141e33-0609-41f2-a7a3-ea078ea3b223');

    await page.getByRole('button', { name: /^Display name / }).click();
    const input = page.getByRole('textbox', { name: 'Enter full name' });
    const originalName = (await input.inputValue()).trim();
    const updatedName = `${originalName} QA`;

    await input.fill(updatedName);
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^Display name ${updatedName}$`) })).toBeVisible();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^Display name ${originalName}$`) })).toBeVisible();
  });
});
