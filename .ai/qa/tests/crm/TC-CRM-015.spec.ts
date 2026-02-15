import { expect, test } from '@playwright/test';
import { createCompanyFixture, deleteEntityIfExists } from '../helpers/crmFixtures';
import { getAuthToken } from '../helpers/api';
import { login } from '../helpers/auth';

/**
 * TC-CRM-015: Customer Search and Filter
 * Source: .ai/qa/scenarios/TC-CRM-015-customer-search-filter.md
 */
test.describe('TC-CRM-015: Customer Search and Filter', () => {
  test.setTimeout(10_000);

  test('should search companies by name/email and filter by status, lifecycle and tag', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;

    const companyName = `QA TC-CRM-015 Co ${Date.now()}`;
    const companyEmail = `qa.crm015.${Date.now()}@example.com`;
    const companyTag = `qa-filter-${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies/${companyId}`);

      await page.getByRole('button', { name: /Primary email/i }).click();
      await page.getByRole('textbox', { name: /Add email|name@example.com/i }).fill(companyEmail);
      await page.getByRole('button', { name: /Save .*Ctrl\+Enter/i }).first().click();
      await expect(page.getByText(companyEmail, { exact: true })).toBeVisible();

      await page.getByRole('button', { name: /^Status/i }).click();
      await page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: 'Active' }) })
        .first()
        .selectOption({ label: 'Active' });
      await page.getByRole('button', { name: /Save .*Ctrl\+Enter/i }).first().click();
      await expect(page.getByRole('button', { name: /Status\s+Active/i })).toBeVisible();

      await page.getByRole('button', { name: /Lifecycle stage/i }).click();
      await page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: 'Prospect' }) })
        .first()
        .selectOption({ label: 'Prospect' });
      await page.getByRole('button', { name: /Save .*Ctrl\+Enter/i }).first().click();
      await expect(page.getByRole('button', { name: /Lifecycle stage\s+Prospect/i })).toBeVisible();

      await page.getByRole('heading', { name: 'Tags' }).locator('xpath=ancestor::div[1]').getByRole('button').click();
      const tagInput = page.getByRole('textbox', { name: 'Type to add tags' });
      await tagInput.fill(companyTag);
      await tagInput.press('Enter');
      await page.getByRole('button', { name: /Save .*Ctrl\+Enter/i }).click();
      await expect(page.getByText(companyTag)).toBeVisible();

      await page.goto('/backend/customers/companies');

      const search = page.getByRole('textbox', { name: /Search companies/i });
      await search.fill(companyName);
      await expect(page.getByRole('link', { name: companyName, exact: true })).toBeVisible();

      await search.fill(companyEmail);
      await expect(page.getByRole('link', { name: companyName, exact: true })).toBeVisible();

      await search.fill('');
      await page.getByRole('button', { name: 'Filters' }).click();
      const filtersDialog = page.getByRole('heading', { name: 'Filters' }).locator('xpath=ancestor::div[2]');
      await expect(filtersDialog.getByRole('combobox').nth(2)).toBeVisible();
      await filtersDialog.getByRole('combobox').nth(0).selectOption({ label: 'Active' });
      await filtersDialog.getByRole('combobox').nth(2).selectOption({ label: 'Prospect' });
      const filterTagInput = filtersDialog.getByRole('textbox', { name: 'Add tag and press Enter' });
      await filterTagInput.fill(companyTag);
      await filterTagInput.press('Enter');
      await filtersDialog.getByRole('button', { name: 'Apply' }).first().click();

      await expect(page.getByRole('button', { name: /Status:\s*Active/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Lifecycle stage:\s*Prospect/i })).toBeVisible();

      await expect(page.getByRole('link', { name: companyName, exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Filters' }).click();
      await filtersDialog.getByRole('button', { name: 'Clear' }).first().click();
      await filtersDialog.getByRole('button', { name: 'Apply' }).first().click();
      await expect(page.getByRole('link', { name: companyName, exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
