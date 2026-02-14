import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CRM-019: Deal Association Remove And Undo
 */
test.describe('TC-CRM-019: Deal Association Remove And Undo', () => {
  test('should remove a linked person from deal and restore via undo', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/deals/34757305-7e77-4c59-aec0-4567f1b76c33');

    await expect(page.getByRole('link', { name: 'Daniel Cho' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove Daniel Cho' }).click();
    await page.getByRole('button', { name: /Update deal/ }).click();

    await expect(page.getByRole('link', { name: 'Daniel Cho' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('link', { name: 'Daniel Cho' })).toBeVisible();
  });
});
