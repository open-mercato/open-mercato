import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';

/**
 * TC-SALES-016: Tax Rate Configuration
 * Source: .ai/qa/scenarios/TC-SALES-016-tax-rate-configuration.md
 */
test.describe('TC-SALES-016: Tax Rate Configuration', () => {
  test('should open tax rate creation dialog in UI', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/config/sales');
    await page.getByRole('button', { name: /Add tax rate/i }).click();
    const dialog = page.getByRole('dialog', { name: /Add tax rate/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Tax rate/i)).toBeVisible();
  });
});
