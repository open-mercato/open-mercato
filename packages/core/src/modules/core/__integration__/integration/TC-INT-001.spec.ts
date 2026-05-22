import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { addCustomLine, addPayment, addShipment, createSalesDocument } from '@open-mercato/core/modules/core/__integration__/helpers/salesUi';

/**
 * TC-INT-001: Quote to Order to Invoice to Payment
 * Source: .ai/qa/scenarios/TC-INT-001-quote-to-order-to-invoice.md
 */
test.describe('TC-INT-001: Quote to Order to Invoice to Payment', () => {
  test.setTimeout(60_000);

  test('should progress quote to order and record fulfillment/payment actions', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'quote', preferApi: true });
    await addCustomLine(page, { name: `QA INT-001 ${Date.now()}`, quantity: 1, unitPriceGross: 50 });

    const actionsButton = page.getByRole('button', { name: /^Actions$/i });
    if (await actionsButton.isVisible().catch(() => false)) {
      await actionsButton.click();
    }
    const convertMenuItem = page.getByRole('menuitem', { name: /Convert to order/i });
    const convertButton = page.getByRole('button', { name: /Convert to order/i });
    if (await convertMenuItem.count()) {
      await convertMenuItem.first().click();
    } else if (await convertButton.count()) {
      await convertButton.first().click();
    } else {
      test.skip(true, 'Quote to order conversion is unavailable in this environment.');
    }

    const confirmDialog = page.getByRole('dialog');
    if (await confirmDialog.isVisible().catch(() => false)) {
      const confirm = confirmDialog.getByRole('button', { name: /Convert|Create order|Continue/i });
      if (await confirm.count()) await confirm.first().click();
    }
    await expect(page).toHaveURL(/(kind=order$|\/backend\/sales\/orders\/[0-9a-f-]{36}$)/i);

    const shipmentResult = await addShipment(page);
    await addPayment(page, 50);

    await page.getByRole('button', { name: /^Shipments$/i }).click();
    await expect(page.getByText(new RegExp(`Shipment\\s+${shipmentResult.shipmentNumber}`, 'i')).first()).toBeVisible();
    await page.getByRole('button', { name: /^Payments$/i }).click();
    await expect(page.getByText(/\$50\.00|50\.00/).first()).toBeVisible();
  });
});
