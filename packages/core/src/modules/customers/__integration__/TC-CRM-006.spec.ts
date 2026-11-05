import { expect, test } from '@playwright/test';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-006: Customer Address Management
 * Source: .ai/qa/scenarios/TC-CRM-006-address-management.md
 */
test.describe('TC-CRM-006: Customer Address Management', () => {
  test('should add multiple company addresses and mark one as primary', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const firstLabel = `HQ ${Date.now()}`;
    const secondLabel = `Warehouse ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-006 ${Date.now()}`);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies/${companyId}`);

      await page.getByRole('tab', { name: 'Addresses' }).click();
      await page.getByRole('button', { name: 'Add address' }).click();
      await page.getByRole('textbox', { name: 'Label' }).fill(firstLabel);
      // Radix Select for address type — click trigger then portal option
      await page.locator('[role="combobox"][aria-expanded="false"]').first().click();
      await page.getByRole('option', { name: 'Office', exact: true }).click();
      await page.getByRole('textbox', { name: 'Address line 1' }).fill('100 Main Street');
      await page.getByRole('textbox', { name: 'City' }).fill('Austin');
      await page.getByRole('textbox', { name: 'Region / State' }).fill('TX');
      await page.getByRole('textbox', { name: 'Postal code' }).fill('78701');
      await page.getByRole('checkbox', { name: 'Set as primary' }).check();
      await page.getByRole('button', { name: /Save address .*Ctrl\+Enter/i }).click();

      await expect(page.getByText(firstLabel, { exact: true })).toBeVisible();
      await expect(page.getByText('Primary', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Add address' }).click();
      await page.getByRole('textbox', { name: 'Label' }).fill(secondLabel);
      // Radix Select for address type — click trigger then portal option
      await page.locator('[role="combobox"][aria-expanded="false"]').first().click();
      await page.getByRole('option', { name: 'Shipping', exact: true }).click();
      await page.getByRole('textbox', { name: 'Address line 1' }).fill('200 Warehouse Road');
      await page.getByRole('textbox', { name: 'City' }).fill('Dallas');
      await page.getByRole('textbox', { name: 'Region / State' }).fill('TX');
      await page.getByRole('textbox', { name: 'Postal code' }).fill('75201');
      await page.getByRole('button', { name: /Save address .*Ctrl\+Enter/i }).click();

      await expect(page.getByText(secondLabel, { exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
