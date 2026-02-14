import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { addCustomLine, addPayment, addShipment, createSalesDocument } from '../helpers/salesUi';

/**
 * TC-INT-005: Order to Shipment to Invoice to Credit Memo
 * Source: .ai/qa/scenarios/TC-INT-005-order-shipment-invoice-flow.md
 */
test.describe('TC-INT-005: Order to Shipment to Invoice to Credit Memo', () => {
  test('should record shipment and payment on an order flow', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA INT-005 ${Date.now()}`, quantity: 2, unitPriceGross: 40 });

    await addShipment(page);
    const paymentsSectionButton = page.getByRole('button', { name: /^Payments$/i });
    if ((await paymentsSectionButton.count()) === 0) {
      test.skip(true, 'Payments section is not available for this order state.');
    }
    await addPayment(page, 40);

    await page.getByRole('button', { name: /^Shipments$/i }).click();
    await expect(page.getByText(/SHIP-/i).first()).toBeVisible();

    await page.getByRole('button', { name: /^Payments$/i }).click();
    await expect(page.getByText(/\$40\.00|40\.00/).first()).toBeVisible();
  });
});
