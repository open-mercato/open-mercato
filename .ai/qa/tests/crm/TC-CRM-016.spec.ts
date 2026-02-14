import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CRM-016: Company Note And Activity CRUD
 */
test.describe('TC-CRM-016: Company Note And Activity CRUD', () => {
  test('should add a company note and log an activity', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/companies');

    const companyLink = page.locator('table tbody tr').first().getByRole('link').first();
    await expect(companyLink).toBeVisible();
    await companyLink.click();

    const noteText = `QA company note ${Date.now()}`;
    await page.getByRole('button', { name: 'Add note' }).click();
    await page.getByRole('textbox', { name: /Write a note about this company/i }).fill(noteText);
    await page.getByRole('button', { name: /Add note.*Ctrl\+Enter/i }).click();
    await expect(page.getByText(noteText)).toBeVisible();

    const activitySubject = `QA company activity ${Date.now()}`;
    const activitiesTab = page.getByRole('tab', { name: 'Activities' });
    if ((await activitiesTab.count()) > 0) {
      await activitiesTab.click();
    } else {
      await page.getByRole('button', { name: 'Activities' }).click();
    }
    await page.getByRole('button', { name: 'Log activity' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add activity' });
    await dialog.getByRole('combobox').first().selectOption({ label: 'Call' });
    await dialog.getByRole('textbox', { name: 'Add a subject (optional)' }).fill(activitySubject);
    await dialog.getByRole('textbox', { name: 'Describe the interaction' }).fill('QA activity description');
    await dialog.getByRole('button', { name: /Save activity/ }).click();

    await expect(page.getByText(activitySubject)).toBeVisible();
  });
});
