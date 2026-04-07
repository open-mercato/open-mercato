import { test, expect } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-032: DataTable Column Chooser
 * Verifies that the column chooser panel opens, allows toggling column visibility,
 * and the table reflects the changes.
 */
test.describe('TC-CRM-032: DataTable Column Chooser', () => {
  test('should toggle column visibility via column chooser on people page', async ({ page }) => {
    test.slow();

    await login(page, 'admin');
    await page.goto('/backend/customers/people', { waitUntil: 'domcontentloaded' });
    await page.getByText('Loading table', { exact: false }).waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});

    const emailHeader = page.locator('thead button', { hasText: 'Email' }).first();
    await expect(emailHeader).toBeVisible();

    const columnChooserButton = page.getByRole('button', { name: 'Choose columns' });
    await expect(columnChooserButton).toBeVisible();
    await columnChooserButton.click();

    const panelTitle = page.getByRole('heading', { name: 'Columns' });
    await expect(panelTitle).toBeVisible();

    // Email is in "Selected columns" section — find its checkbox (role=checkbox sibling of "Email" span)
    const emailItem = page.locator('div').filter({ hasText: /^Email$/ }).locator('button[role="checkbox"]').first();
    await expect(emailItem).toBeVisible();
    await emailItem.click();

    const closeButton = page.getByRole('button', { name: 'Close' });
    await closeButton.click();

    await expect(emailHeader).not.toBeVisible();

    // Re-enable: Email is now in "Available columns" section as a label with checkbox
    await columnChooserButton.click();
    await expect(panelTitle).toBeVisible();
    const emailAvailable = page.locator('label').filter({ hasText: 'Email' }).locator('button[role="checkbox"]').first();
    await expect(emailAvailable).toBeVisible();
    await emailAvailable.click();
    await page.getByRole('button', { name: 'Close' }).click();

    await expect(page.locator('thead button', { hasText: 'Email' }).first()).toBeVisible();
  });
});
