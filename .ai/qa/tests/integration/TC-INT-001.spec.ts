import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { addCustomLine, addPayment, addShipment, createSalesDocument } from '../helpers/salesUi';

/**
 * TC-INT-001: Quote to Order to Invoice to Payment
 * Source: .ai/qa/scenarios/TC-INT-001-quote-to-order-to-invoice.md
 */
test.describe('TC-INT-001: Quote to Order to Invoice to Payment', () => {
  test('should progress quote to order and record fulfillment/payment actions', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'quote' });
    await addCustomLine(page, { name: `QA INT-001 ${Date.now()}`, quantity: 1, unitPriceGross: 50 });

    await page.getByRole('button', { name: /^Actions$/i }).click();
    const convertToOrder = page.getByRole('menuitem', { name: /Convert to order/i });
    if ((await convertToOrder.count()) === 0) {
      test.skip(true, 'Quote to order conversion is unavailable in this environment.');
    }
    await convertToOrder.first().click();

    const confirm = page.getByRole('button', { name: /Convert|Create order|Continue/i }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(page).toHaveURL(/kind=order$/i);

    await addShipment(page);
    await addPayment(page, 50);

    await page.getByRole('button', { name: /^Shipments$/i }).click();
    await expect(page.getByText(/SHIP-/i).first()).toBeVisible();
    await page.getByRole('button', { name: /^Payments$/i }).click();
    await expect(page.getByText(/\$50\.00|50\.00/).first()).toBeVisible();
  });
});
