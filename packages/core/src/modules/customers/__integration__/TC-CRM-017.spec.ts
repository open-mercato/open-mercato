import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-017: Company Delete And Undo
 */
test.describe('TC-CRM-017: Company Delete And Undo', () => {
  test('should delete a company and restore it via undo', async ({ page, request }) => {
    test.slow();
    let token: string | null = null;
    let companyId: string | null = null;
    const companyName = `QA TC-CRM-017 ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'commit' });

      const deleteButton = page.getByRole('button', { name: /^Delete(?: company)?$/ }).first();
      const detailReady = await deleteButton.isVisible({ timeout: 15_000 }).catch(() => false);
      if (!detailReady) {
        await page.reload({ waitUntil: 'commit' }).catch(() => {});
        await expect(deleteButton).toBeVisible({ timeout: 15_000 });
      }
      await deleteButton.click();
      const confirmDialog = page.getByRole('alertdialog', { name: /delete company\??/i });
      await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
      await confirmDialog.getByRole('button', { name: /^Delete(?: company)?$|^Confirm$/i }).click();

      await expect(page).toHaveURL(/\/backend\/customers\/companies$/);
      const undoButton = page.getByRole('button', { name: /^Undo(?: last action)?$/ });
      await expect(undoButton).toBeVisible();
      const undoResponsePromise = page.waitForResponse((response) => {
        return response.url().includes('/api/audit_logs/audit-logs/actions/undo') && response.request().method() === 'POST';
      });
      const undoNavigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
      await undoButton.click();
      const [undoResponse] = await Promise.all([undoResponsePromise, undoNavigationPromise]);
      expect(undoResponse.ok()).toBeTruthy();

      await expect(page).toHaveURL(/\/backend\/customers\/companies$/);
      const restoredCompanyLink = page.getByRole('link', { name: companyName, exact: true }).first();
      await expect(restoredCompanyLink).toBeVisible();
      await Promise.all([
        page.waitForURL(new RegExp(`/backend/customers/companies-v2/${companyId}$`), { waitUntil: 'commit' }),
        restoredCompanyLink.click(),
      ]);
      await expect(page.getByText(companyName, { exact: true }).first()).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
