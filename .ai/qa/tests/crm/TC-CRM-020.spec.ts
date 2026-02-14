import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-CRM-020: Deal Note And Activity Creation
 */
test.describe('TC-CRM-020: Deal Note And Activity Creation', () => {
  test('should add a deal note and log a deal activity', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/customers/deals/34757305-7e77-4c59-aec0-4567f1b76c33');

    const noteText = `QA deal note ${Date.now()}`;
    await page.getByRole('button', { name: 'Add a note' }).click();
    await page.getByRole('textbox', { name: 'Write a note about this person…' }).fill(noteText);
    await page.getByRole('button', { name: /Add note/ }).click();
    await expect(page.getByText(noteText)).toBeVisible();

    const activitySubject = `QA deal activity ${Date.now()}`;
    await page.getByRole('button', { name: 'Activities' }).click();
    await page.getByRole('button', { name: 'Log activity' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add activity' });
    await dialog.getByRole('combobox').first().selectOption({ label: 'Note' });
    await dialog.getByRole('textbox', { name: 'Add a subject (optional)' }).fill(activitySubject);
    await dialog.getByRole('textbox', { name: 'Describe the interaction' }).fill('QA deal activity description');
    await dialog.getByRole('button', { name: /Save activity/ }).click();

    await expect(page.getByText(activitySubject)).toBeVisible();
  });
});
