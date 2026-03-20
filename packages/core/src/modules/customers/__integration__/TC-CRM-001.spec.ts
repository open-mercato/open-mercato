import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-001: Company Creation
 * Source: .ai/qa/scenarios/TC-CRM-001-company-creation.md
 */
test.describe('TC-CRM-001: Company Creation', () => {
  test('should create a company from create form and show it in companies list', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    const companyName = `QA TC-CRM-001 ${Date.now()}`;

    try {
      token = await getAuthToken(request);

      await login(page, 'admin');
      await page.goto('/backend/customers/companies/create');
      await page.locator('form').getByRole('textbox').first().fill(companyName);
      await page.getByPlaceholder('https://example.com').fill('https://example.com');
      await page.locator('form').getByRole('button', { name: /Create Company/i }).click();

      await expect(page).toHaveURL(/\/backend\/customers\/companies-v2\/[0-9a-f-]{36}$/i);
      await expect(page.getByText(companyName, { exact: true }).first()).toBeVisible();

      const url = page.url();
      const idMatch = url.match(/\/backend\/customers\/companies-v2\/([0-9a-f-]{36})$/i);
      companyId = idMatch ? idMatch[1] : null;
      expect(companyId, 'Expected created company id in detail URL').toBeTruthy();

      await expect
        .poll(
          async () => {
            await page.goto('/backend/customers/companies');
            await page.getByRole('button', { name: 'Refresh' }).waitFor();
            await page.getByRole('button', { name: 'Refresh' }).click();
            await page.getByRole('textbox', { name: /Search companies/i }).fill(companyName);
            await page.waitForTimeout(1000);
            await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return await page.getByRole('link', { name: companyName, exact: true }).count();
          },
          { timeout: 60000 },
        )
        .toBeGreaterThan(0);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
