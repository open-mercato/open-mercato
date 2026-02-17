import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { getAuthToken } from './helpers/api';
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from './helpers/crmFixtures';

/**
 * TC-CRM-020: Deal Note And Activity Creation
 */
test.describe('TC-CRM-020: Deal Note And Activity Creation', () => {
  test('should add a deal note and log a deal activity', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let personId: string | null = null;
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-020 Company ${Date.now()}`);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TCCRM020${Date.now()}`,
        displayName: `QA TC-CRM-020 Person ${Date.now()}`,
        companyEntityId: companyId,
      });
      dealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-020 Deal ${Date.now()}`,
        companyIds: [companyId],
        personIds: [personId],
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);

      const noteText = `QA deal note ${Date.now()}`;
      await page.getByRole('button', { name: /Add( a)? note/i }).first().click();
      await page.getByRole('textbox', { name: /Write a note/i }).fill(noteText);
      await page.getByRole('button', { name: /Add note.*Ctrl\+Enter/i }).click();
      await expect(page.getByText(noteText)).toBeVisible();

      const activitySubject = `QA deal activity ${Date.now()}`;
      const activitiesTab = page.getByRole('tab', { name: 'Activities' });
      if ((await activitiesTab.count()) > 0) {
        await activitiesTab.click();
      } else {
        await page.getByRole('button', { name: 'Activities' }).click();
      }
      await page.getByRole('button', { name: /Log activity|Add an activity/i }).click();

      const dialog = page.getByRole('dialog', { name: 'Add activity' });
      const linkedDealSelect = dialog.getByRole('combobox').nth(1);
      const linkedDealOptions = await linkedDealSelect.locator('option').count();
      if (linkedDealOptions > 1) {
        await linkedDealSelect.selectOption({ index: 1 });
      }
      const typeSelect = dialog.getByRole('combobox').nth(2);
      await typeSelect.selectOption({ label: 'Call' });
      await dialog.getByRole('textbox', { name: 'Add a subject (optional)' }).fill(activitySubject);
      await dialog.getByRole('textbox', { name: 'Describe the interaction' }).fill('QA deal activity description');
      await dialog.getByRole('button', { name: /Save activity/ }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText('No activities yet')).toHaveCount(0);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
