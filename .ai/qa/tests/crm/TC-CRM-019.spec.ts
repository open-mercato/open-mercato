import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CRM-019: Deal Association Remove And Undo
 */
test.describe('TC-CRM-019: Deal Association Remove And Undo', () => {
  test('should remove a linked person from deal and restore via undo', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/deals');

    const dealRows = page.locator('table tbody tr');
    const dealCount = await dealRows.count();
    expect(dealCount, 'Expected at least one deal row').toBeGreaterThan(0);

    let removedButtonLabel: string | null = null;
    for (let i = 0; i < dealCount; i += 1) {
      await dealRows.nth(i).click();
      const removeButton = page.getByRole('button', { name: /^Remove / }).first();
      if ((await removeButton.count()) === 0) {
        await page.goto('/backend/customers/deals');
        continue;
      }

      removedButtonLabel = (await removeButton.innerText()).trim();
      await removeButton.click();
      break;
    }

    expect(removedButtonLabel, 'Expected at least one deal with a linked person to remove').not.toBeNull();
    const personRemoveButtonName = removedButtonLabel as string;
    await page.getByRole('button', { name: /Update deal/ }).click();

    await expect(page.getByRole('button', { name: personRemoveButtonName, exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /^Undo(?: last action)?$/ }).click();
    await expect(page.getByRole('button', { name: personRemoveButtonName, exact: true })).toBeVisible();
  });
});
