import { expect, test } from '@playwright/test';
import { createCompanyFixture, deleteEntityIfExists } from '../../core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '../../core/__integration__/helpers/api';
import { login } from '../../core/__integration__/helpers/auth';

/**
 * TC-CRM-012: Tag Customers for Segmentation
 * Source: .ai/qa/scenarios/TC-CRM-012-customer-tagging.md
 */
test.describe('TC-CRM-012: Tag Customers for Segmentation', () => {
  test('should assign multiple tags to a company and filter list by assigned tag', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;

    const companyName = `QA TC-CRM-012 Co ${Date.now()}`;
    const tagOne = `qa-seg-${Date.now()}`;
    const tagTwo = `qa-tier-${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies/${companyId}`);

      await page.getByRole('heading', { name: 'Tags' }).locator('xpath=ancestor::div[1]').getByRole('button').click();
      const tagInput = page.getByRole('textbox', { name: 'Type to add tags' });
      await tagInput.fill(tagOne);
      await tagInput.press('Enter');
      await tagInput.fill(tagTwo);
      await tagInput.press('Enter');
      await page.getByRole('button', { name: /Save .*Ctrl\+Enter/i }).click();

      await expect(page.getByText(tagOne)).toBeVisible();
      await expect(page.getByText(tagTwo)).toBeVisible();

      await page.goto('/backend/customers/companies');
      await page.getByRole('button', { name: 'Filters' }).click();
      const filterTagInput = page.getByRole('textbox', { name: 'Add tag and press Enter' });
      await filterTagInput.fill(tagOne);
      await filterTagInput.press('Enter');
      await page.getByRole('button', { name: 'Apply' }).last().click();

      await expect(page.getByRole('link', { name: companyName, exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
