import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { addCustomLine, addPayment, createSalesDocument } from './helpers/salesUi';

/**
 * TC-SALES-010: Payment Recording
 * Source: .ai/qa/scenarios/TC-SALES-010-payment-recording.md
 */
test.describe('TC-SALES-010: Payment Recording', () => {
  test('should record payment from order payments UI', async ({ page }) => {
    const amount = 42.37;
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA TC-SALES-010 ${Date.now()}`, quantity: 1, unitPriceGross: 42 });
    const paymentResult = await addPayment(page, amount);
    expect(paymentResult.added, 'Payment should be saved successfully').toBeTruthy();
    await page.getByRole('button', { name: /^Payments$/i }).click();
    await expect(page.getByText(/Last operation:\s*Create payment/i).first()).toBeVisible();
  });
});
