import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { addCustomLine, addPayment, createSalesDocument, readGrandTotalGross } from '../helpers/salesUi';

/**
 * TC-SALES-019: Payment Entry and Grand Total Stability
 * Source: .ai/qa/scenarios/TC-SALES-019-payment-entry-total-stability.md
 */
test.describe('TC-SALES-019: Payment Entry and Grand Total Stability', () => {
  test('should keep grand total stable after payment is recorded', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA TC-SALES-019 Item ${Date.now()}`, quantity: 1, unitPriceGross: 60 });

    const grossBeforePayment = await readGrandTotalGross(page);
    const paymentResult = await addPayment(page, 20);
    expect(paymentResult.added, 'Payment should be saved successfully').toBeTruthy();

    const grossAfterPayment = await readGrandTotalGross(page);
    expect(grossAfterPayment).toBe(grossBeforePayment);
  });
});
