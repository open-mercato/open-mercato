import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-SALES-014: Shipping Method Config
 * Source: .ai/qa/scenarios/TC-SALES-014-shipping-method-config.md
 */
test.describe('TC-SALES-014: Shipping Method Config', () => {
  test('should open shipping method creation dialog in UI', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/config/sales');
    await page.getByRole('button', { name: /Add shipping method/i }).click();
    const dialog = page.getByRole('dialog', { name: /Add shipping method/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Shipping/i)).toBeVisible();
  });
});
