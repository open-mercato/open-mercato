import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CRM-020: Deal Note And Activity Creation
 */
test.describe('TC-CRM-020: Deal Note And Activity Creation', () => {
  test('should add a deal note and log a deal activity', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/deals');

    const dealRow = page.locator('table tbody tr').first();
    await expect(dealRow).toBeVisible();
    await dealRow.click();

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
    await page.getByRole('button', { name: 'Log activity' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add activity' });
    await dialog.getByRole('combobox').first().selectOption({ label: 'Note' });
    await dialog.getByRole('textbox', { name: 'Add a subject (optional)' }).fill(activitySubject);
    await dialog.getByRole('textbox', { name: 'Describe the interaction' }).fill('QA deal activity description');
    await dialog.getByRole('button', { name: /Save activity/ }).click();

    await expect(page.getByText(activitySubject)).toBeVisible();
  });
});
