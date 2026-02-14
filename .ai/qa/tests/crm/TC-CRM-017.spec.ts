import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CRM-017: Company Delete And Undo
 */
test.describe('TC-CRM-017: Company Delete And Undo', () => {
  test('should delete a company and restore it via undo', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/companies');

    await page.getByRole('textbox', { name: 'Search companies' }).fill('Harborview Analytics');
    await page.getByRole('link', { name: 'Harborview Analytics' }).click();

    await page.getByRole('button', { name: 'Delete company' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page).toHaveURL(/\/backend\/customers\/companies$/);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();

    await page.getByRole('textbox', { name: 'Search companies' }).fill('Harborview Analytics');
    await expect(page.getByRole('link', { name: 'Harborview Analytics' })).toBeVisible();
  });
});
