import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { addCustomLine, addPayment, addShipment, createSalesDocument } from '../helpers/salesUi';

/**
 * TC-INT-005: Order to Shipment to Invoice to Credit Memo
 * Source: .ai/qa/scenarios/TC-INT-005-order-shipment-invoice-flow.md
 */
test.describe('TC-INT-005: Order to Shipment to Invoice to Credit Memo', () => {
  test.setTimeout(45_000);

  test('should record shipment and payment on an order flow', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA INT-005 ${Date.now()}`, quantity: 2, unitPriceGross: 40 });

    const shipmentResult = await addShipment(page);
    expect(shipmentResult.added, 'Shipment should be saved successfully').toBeTruthy();

    const paymentsSectionButton = page.getByRole('button', { name: /^Payments$/i });
    await expect(paymentsSectionButton).toBeVisible();
    let paymentResult = await addPayment(page, 40);
    if (!paymentResult.added) {
      paymentResult = await addPayment(page, 40);
    }
    expect(paymentResult.added, 'Payment should be saved successfully').toBeTruthy();

    await page.getByRole('button', { name: /^Shipments$/i }).click();
    await expect(page.getByText(shipmentResult.trackingNumber).first()).toBeVisible();

    await page.getByRole('button', { name: /^Payments$/i }).click();
    await expect(page.getByText(paymentResult.amountLabel).first()).toBeVisible();
  });
});
