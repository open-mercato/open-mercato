import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { addCustomLine, addShipment, createSalesDocument } from '../helpers/salesUi';

/**
 * TC-SALES-007: Shipment Recording
 * Source: .ai/qa/scenarios/TC-SALES-007-shipment-recording.md
 */
test.describe('TC-SALES-007: Shipment Recording', () => {
  test('should create shipment from order UI', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, {
      name: `QA TC-SALES-007 ${Date.now()}`,
      quantity: 1,
      unitPriceGross: 42,
    });
    let shipmentResult = await addShipment(page);
    if (!shipmentResult.added) {
      shipmentResult = await addShipment(page);
    }
    expect(shipmentResult.added, 'Shipment should be saved successfully').toBeTruthy();
    await page.getByRole('button', { name: /^Shipments$/i }).click();
    await expect(page.getByText(shipmentResult.trackingNumber).first()).toBeVisible();
  });
});
