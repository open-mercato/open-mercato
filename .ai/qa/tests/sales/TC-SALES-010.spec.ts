import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { addCustomLine, createSalesDocument } from '../helpers/salesUi';

/**
 * TC-SALES-010: Payment Recording
 * Source: .ai/qa/scenarios/TC-SALES-010-payment-recording.md
 */
test.describe('TC-SALES-010: Payment Recording', () => {
  test('should record payment from order payments UI', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA TC-SALES-010 ${Date.now()}`, quantity: 1, unitPriceGross: 42 });
    await page.getByRole('button', { name: /^Payments$/i }).click();
    await page.getByRole('button', { name: /Add payment/i }).click();
    await expect(page.getByRole('dialog', { name: /Add payment/i })).toBeVisible();
  });
});
