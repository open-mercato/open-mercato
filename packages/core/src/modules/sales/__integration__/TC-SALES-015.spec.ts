import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-SALES-015: Payment Method Config
 * Source: .ai/qa/scenarios/TC-SALES-015-payment-method-config.md
 */
test.describe('TC-SALES-015: Payment Method Config', () => {
  test('should open payment method creation dialog in UI', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/backend/config/sales');
    await page.getByRole('button', { name: /Add payment method/i }).click();
    const dialog = page.getByRole('dialog', { name: /Add payment method/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Payment/i)).toBeVisible();
  });
});
