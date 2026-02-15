import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { getAuthToken } from '../helpers/api';
import { createCompanyFixture, deleteEntityIfExists } from '../helpers/crmFixtures';

/**
 * TC-CRM-016: Company Note And Activity CRUD
 */
test.describe('TC-CRM-016: Company Note And Activity CRUD', () => {
  test.setTimeout(120_000);

  test('should add a company note and log an activity', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-016 Company ${Date.now()}`);

      await login(page, 'admin');
      await page.goto(`/backend/customers/companies/${companyId}`);

      const noteText = `QA company note ${Date.now()}`;
      await page.getByRole('button', { name: /Add( a)? note/i }).first().click();
      await page.getByRole('textbox', { name: /Write a note about this company/i }).fill(noteText);
      await page.getByRole('button', { name: /Add note.*Ctrl\+Enter/i }).click();
      await expect(page.getByText(noteText)).toBeVisible();

      const activitySubject = `QA company activity ${Date.now()}`;
      const activitiesTab = page.getByRole('tab', { name: 'Activities' });
      if ((await activitiesTab.count()) > 0) {
        await activitiesTab.click();
      } else {
        await page.getByRole('button', { name: /^Activities$/i }).click();
      }
      await page.getByRole('button', { name: /Log activity|Add an activity/i }).first().click();

      const dialog = page.getByRole('dialog', { name: 'Add activity' });
      await expect(dialog).toBeVisible();
      await dialog
        .locator('select')
        .filter({ has: dialog.locator('option', { hasText: /^Call$/i }) })
        .first()
        .selectOption({ label: 'Call' });
      await dialog.getByRole('textbox', { name: 'Add a subject (optional)' }).fill(activitySubject);
      await dialog.getByRole('textbox', { name: 'Describe the interaction' }).fill('QA activity description');
      await dialog.getByRole('button', { name: /Save activity/ }).click();
      await expect(dialog).toBeHidden();

      await expect(page.getByText('No activities yet')).toHaveCount(0);
      await expect(page.getByText(activitySubject).first()).toBeVisible();
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
