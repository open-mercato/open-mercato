import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { addCustomLine, addShipment, createSalesDocument, readGrandTotalGross } from '../helpers/salesUi';

/**
 * TC-SALES-018: Shipment Cost Impact on Totals
 * Source: .ai/qa/scenarios/TC-SALES-018-shipment-cost-total-impact.md
 */
test.describe('TC-SALES-018: Shipment Cost Impact on Totals', () => {
  test('should change totals after recording shipment with tracking', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA TC-SALES-018 Item ${Date.now()}`, quantity: 1, unitPriceGross: 80 });

    const grossBeforeShipment = await readGrandTotalGross(page);
    let shipmentResult = await addShipment(page);
    if (!shipmentResult.added) {
      shipmentResult = await addShipment(page);
    }
    expect(shipmentResult.added, 'Shipment should be saved successfully').toBeTruthy();

    const grossAfterShipment = await readGrandTotalGross(page);
    expect(grossAfterShipment).toBeGreaterThan(grossBeforeShipment);

    await page.getByRole('button', { name: /^Shipments$/i }).click();
    await expect(page.getByText(shipmentResult.trackingNumber).first()).toBeVisible();
  });
});
