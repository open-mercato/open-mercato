import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

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
      await expect(page).toHaveURL(/\/backend\/customers\/companies\/create$/i);

      await page.locator('form').getByRole('textbox').first().fill(companyName);
      await page.getByPlaceholder('name@example.com').fill('invalid-email');
      await page.getByPlaceholder('https://example.com').fill('notaurl');
      // Tab away from the URL field so React commits the controlled value before
      // submit — otherwise the click may race the onChange and submit '' for URL.
      await page.getByPlaceholder('https://example.com').press('Tab');
      await page.getByRole('button', { name: 'Create Company' }).first().click();

      // Both validation errors render under their respective fields after submit.
      // Wait for both in parallel with extended timeouts — CI can be slow to flush
      // the form's setErrors state for the second field.
      await Promise.all([
        expect(page.getByText('Invalid email address')).toBeVisible({ timeout: 10_000 }),
        expect(page.getByText('Invalid URL')).toBeVisible({ timeout: 10_000 }),
      ]);

      await page.getByPlaceholder('name@example.com').fill('qa+crm002@example.com');
      await page.getByPlaceholder('https://example.com').fill('https://example.com');
      await page.getByRole('button', { name: 'Create Company' }).first().click();

      await expect(page).toHaveURL(/\/backend\/customers\/companies-v2\/[0-9a-f-]{36}$/i);
      await expect(page.getByText(companyName, { exact: true }).first()).toBeVisible();

      const idMatch = page.url().match(/\/backend\/customers\/companies-v2\/([0-9a-f-]{36})$/i);
      companyId = idMatch?.[1] ?? null;
      expect(companyId, 'Expected created company id in detail URL').toBeTruthy();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
