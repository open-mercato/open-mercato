import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-017: Company Delete And Undo
 */
test.describe('TC-CRM-017: Company Delete And Undo', () => {
  test('should delete a company and restore it via undo', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    const companyName = `QA TC-CRM-017 ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies/${companyId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: 'Delete company' })).toBeVisible();

      await page.getByRole('button', { name: 'Delete company' }).click();
      await page.getByRole('button', { name: 'Confirm' }).click();

      await expect(page).toHaveURL(/\/backend\/customers\/companies$/);
      const undoButton = page.getByRole('button', { name: /^Undo(?: last action)?$/ });
      await expect(undoButton).toBeVisible();
      const undoResponsePromise = page.waitForResponse((response) => {
        return response.url().includes('/api/audit_logs/audit-logs/actions/undo') && response.request().method() === 'POST';
      });
      await undoButton.click();
      const undoResponse = await undoResponsePromise;
      expect(undoResponse.ok()).toBeTruthy();

      await page.waitForLoadState('domcontentloaded').catch(() => {});

      await page.getByRole('textbox', { name: /Search companies/i }).fill(companyName);
      await page.waitForTimeout(1_200);
      await expect(page.getByRole('link', { name: companyName, exact: true })).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
