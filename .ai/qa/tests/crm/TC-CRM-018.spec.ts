import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CRM-018: Person Display Name Edit And Undo
 */
test.describe('TC-CRM-018: Person Display Name Edit And Undo', () => {
  test('should edit person display name and undo the update', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/people');

    const personRow = page.locator('table tbody tr').first();
    await expect(personRow).toBeVisible();
    await personRow.click();

    const displayNameButton = page.getByRole('button', { name: /^Display name / });
    if ((await displayNameButton.count()) > 0) {
      await displayNameButton.click();
    }

    const input = page.getByRole('textbox', { name: /Enter (display name|full name)/i });
    const originalName = (await input.inputValue()).trim();
    const updatedName = `${originalName} QA`;

    await input.fill(updatedName);
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByText(updatedName, { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: /^Undo(?: last action)?$/ }).click();
    await expect(page.getByText(originalName, { exact: true }).first()).toBeVisible();
  });
});
