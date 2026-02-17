import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { deleteEntityIfExists } from './helpers/crmFixtures';
import { getAuthToken } from './helpers/api';

/**
 * TC-CRM-002: Company Creation Validation Errors
 * Source: .ai/qa/scenarios/TC-CRM-002-company-creation-validation.md
 */
test.describe('TC-CRM-002: Company Creation Validation Errors', () => {
  test('should block invalid input, show field errors, then allow create after correction', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const companyName = `QA TC-CRM-002 ${Date.now()}`;

    try {
      token = await getAuthToken(request);

      await login(page, 'admin');
      await page.goto('/backend/customers/companies/create');

      await page.getByRole('button', { name: 'Create Company' }).first().click();
      await expect(page.getByText('This field is required')).toBeVisible();

      await page.locator('form').getByRole('textbox').first().fill(companyName);
      await page.getByPlaceholder('name@example.com').fill('invalid-email');
      await page.getByPlaceholder('https://example.com').fill('notaurl');
      await page.getByRole('button', { name: 'Create Company' }).first().click();

      await expect(page.getByText('Invalid email address')).toBeVisible();
      await expect(page.getByText('Invalid URL')).toBeVisible();

      await page.getByPlaceholder('name@example.com').fill('qa+crm002@example.com');
      await page.getByPlaceholder('https://example.com').fill('https://example.com');
      await page.getByRole('button', { name: 'Create Company' }).first().click();

      await expect(page).toHaveURL(/\/backend\/customers\/companies\/[0-9a-f-]{36}$/i);
      await expect(page.getByRole('button', { name: companyName, exact: true }).first()).toBeVisible();

      const idMatch = page.url().match(/\/backend\/customers\/companies\/([0-9a-f-]{36})$/i);
      companyId = idMatch?.[1] ?? null;
      expect(companyId, 'Expected created company id in detail URL').toBeTruthy();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
