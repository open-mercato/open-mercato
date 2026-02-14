import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { createCompanyFixture, deleteEntityIfExists } from '../helpers/crmFixtures';
import { getAuthToken } from '../helpers/api';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * TC-CRM-003: Edit Company Details
 * Source: .ai/qa/scenarios/TC-CRM-003-company-edit.md
 */
test.describe('TC-CRM-003: Edit Company Details', () => {
  test('should update company fields from detail page and persist changes in list view', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const originalName = `QA TC-CRM-003 Original ${Date.now()}`;
    const updatedName = `QA TC-CRM-003 Updated ${Date.now()}`;
    const updatedWebsite = `https://crm003-${Date.now()}.example.com`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, originalName);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies/${companyId}`);

      await page.getByRole('button', { name: new RegExp(`Display name\\s+${escapeRegex(originalName)}`) }).click();
      await page.getByRole('textbox', { name: 'Enter company name' }).fill(updatedName);
      await page.getByRole('button', { name: /Save .*Ctrl\+Enter/i }).first().click();
      await expect(page.getByRole('button', { name: new RegExp(`Display name\\s+${escapeRegex(updatedName)}`) })).toBeVisible();

      await page.getByRole('button', { name: /Website/i }).click();
      await page.getByPlaceholder('https://example.com').fill(updatedWebsite);
      await page.getByRole('button', { name: /Save .*Ctrl\+Enter/i }).first().click();
      await expect(page.getByRole('button', { name: new RegExp(`Website\\s+${escapeRegex(updatedWebsite)}`) })).toBeVisible();

      await page.getByRole('button', { name: /Lifecycle stage/i }).click();
      await page
        .locator('select')
        .filter({ has: page.locator('option', { hasText: 'Prospect' }) })
        .first()
        .selectOption({ label: 'Prospect' });
      await page.getByRole('button', { name: /Save .*Ctrl\+Enter/i }).first().click();
      await expect(page.getByRole('button', { name: /Lifecycle stage\s+Prospect/i })).toBeVisible();

      await page.goto('/backend/customers/companies');
      await page.getByRole('textbox', { name: /Search companies/i }).fill(updatedName);
      await expect(page.getByRole('link', { name: updatedName, exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
