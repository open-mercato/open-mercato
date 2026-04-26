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

      // Target by field id rather than placeholder — placeholder lookup
      // was racing onto the wrong input under DS v2 (notaurl ended up in
      // the email field instead of website on CI screenshots).
      await page.locator('[data-crud-field-id="displayName"] input').fill(companyName);
      await page.locator('[data-crud-field-id="primaryEmail"] input').fill('invalid-email');
      await page.locator('[data-crud-field-id="websiteUrl"] input').fill('notaurl');
      await page.getByRole('button', { name: 'Create Company' }).first().click();

      await expect(page.getByText('Invalid email address')).toBeVisible();
      await expect(page.getByText('Invalid URL')).toBeVisible();

      await page.locator('[data-crud-field-id="primaryEmail"] input').fill('qa+crm002@example.com');
      await page.locator('[data-crud-field-id="websiteUrl"] input').fill('https://example.com');
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
