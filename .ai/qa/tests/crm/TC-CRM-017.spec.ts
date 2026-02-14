import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { getAuthToken } from '../helpers/api';
import { createCompanyFixture, deleteEntityIfExists } from '../helpers/crmFixtures';

/**
 * TC-CRM-017: Company Delete And Undo
 */
test.describe('TC-CRM-017: Company Delete And Undo', () => {
  test('should delete a company and restore it via undo', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const companyName = `QA TC-CRM-017 ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);

      await login(page, 'admin');
      await page.goto('/backend/customers/companies');
      await page.getByRole('textbox', { name: 'Search companies' }).fill(companyName);
      await page.getByRole('link', { name: companyName, exact: true }).click();

      await page.getByRole('button', { name: 'Delete company' }).click();
      await page.getByRole('button', { name: 'Confirm' }).click();

      await expect(page).toHaveURL(/\/backend\/customers\/companies$/);
      await expect(page.getByRole('button', { name: /^Undo(?: last action)?$/ })).toBeVisible();
      await page.getByRole('button', { name: /^Undo(?: last action)?$/ }).click();

      await page.getByRole('textbox', { name: 'Search companies' }).fill(companyName);
      await expect(page.getByRole('link', { name: companyName, exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
