import { expect, test } from '@playwright/test';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-012: Tag Customers for Segmentation
 * Source: .ai/qa/scenarios/TC-CRM-012-customer-tagging.md
 */
test.describe('TC-CRM-012: Tag Customers for Segmentation', () => {
  test('should assign multiple tags to a company and filter list by assigned tag', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;

    const companyName = `QA TC-CRM-012 Co ${Date.now()}`;
    const tagOne = `qa-seg-${Date.now()}`;
    const tagTwo = `qa-tier-${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies-v2/${companyId}`);

      await page.getByRole('heading', { name: 'Tags' }).locator('xpath=ancestor::div[1]').getByRole('button').click();
      const tagInput = page.getByRole('textbox', { name: 'Type to add tags' });
      await tagInput.fill(tagOne);
      await tagInput.press('Enter');
      await tagInput.fill(tagTwo);
      await tagInput.press('Enter');
      const saveTagsButton = page.getByRole('button', { name: /Save .*Ctrl\+Enter/i });
      await saveTagsButton.click();
      await expect(saveTagsButton).toHaveCount(0);

      await expect(page.getByText(tagOne)).toBeVisible();
      await expect(page.getByText(tagTwo)).toBeVisible();

      await page.goto('/backend/customers/companies');
      await page.getByRole('button', { name: 'Refresh' }).waitFor();
      await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      await page.getByRole('button', { name: /^Filters/ }).click();
      const filterTagInput = page.getByPlaceholder('Add tag and press Enter');
      try {
        await expect(filterTagInput).toBeVisible({ timeout: 5000 });
      } catch {
        await page.getByRole('button', { name: /^Filters/ }).click();
        await expect(filterTagInput).toBeVisible();
      }
      await filterTagInput.fill(tagOne);
      const tagSuggestion = page.getByRole('button', { name: tagOne, exact: true }).last();
      await expect(tagSuggestion).toBeVisible();
      await tagSuggestion.click();
      await page.getByRole('button', { name: 'Apply' }).last().click();

      await expect
        .poll(
          async () => {
            await page.waitForTimeout(500);
            await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            return await page.getByRole('link', { name: companyName, exact: true }).count();
          },
          { timeout: 20000 },
        )
        .toBeGreaterThan(0);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
