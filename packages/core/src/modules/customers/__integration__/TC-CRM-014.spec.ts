import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-014: Delete Customer
 * Source: .ai/qa/scenarios/TC-CRM-014-customer-deletion.md
 */
test.describe('TC-CRM-014: Delete Customer', () => {
  test('should delete a company and remove it from active company list', async ({ page, request }) => {
    const companyName = `QA TC-CRM-014 ${Date.now()}`;
    const token = await getAuthToken(request);
    const companyId = await createCompanyFixture(request, token, companyName);

    await login(page, 'admin');
    await page.goto('/backend/customers/companies');
    await page.getByRole('textbox', { name: 'Search companies' }).fill(companyName);
    await page.getByRole('link', { name: companyName, exact: true }).click();

    await page.getByRole('button', { name: 'Delete company' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page).toHaveURL(/\/backend\/customers\/companies$/);
    await page.getByRole('textbox', { name: 'Search companies' }).fill(companyName);
    await expect(page.getByRole('link', { name: companyName, exact: true })).toHaveCount(0);

    await page.getByRole('textbox', { name: 'Search companies' }).fill(companyId);
    await expect(page.getByText(companyId)).toHaveCount(0);
  });
});
