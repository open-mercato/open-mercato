import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CRM-016: Company Edit History And Undo
 */
test.describe('TC-CRM-016: Company Edit History And Undo', () => {
  test('should record company name edit in history and undo the change', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/companies');

    const firstCompanyLink = page.getByRole('row').nth(1).getByRole('link').first();
    await expect(firstCompanyLink).toBeVisible();

    const originalName = (await firstCompanyLink.innerText()).trim();
    const updatedName = `${originalName} QA Undo`;

    await firstCompanyLink.click();
    await expect(page.getByRole('button', { name: originalName, exact: true })).toBeVisible();

    await page.getByRole('button', { name: /^Display name / }).click();
    await page.getByRole('textbox', { name: 'Enter company name' }).fill(updatedName);
    await page.getByRole('button', { name: /^Save / }).click();

    await expect(page.getByRole('button', { name: updatedName, exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Version History' }).click();
    await expect(page.getByRole('heading', { name: 'Version History' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Update company.*Done/ })).toBeVisible();

    await page.getByRole('button', { name: 'Undo last action' }).click();
    await expect(page.getByRole('button', { name: originalName, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Display name / })).toContainText(originalName);
  });
});
