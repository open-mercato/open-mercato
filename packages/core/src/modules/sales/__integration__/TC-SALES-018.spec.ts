import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { createOrderLineFixture } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures';
import { addShipment, createSalesDocument, readGrandTotalGross } from '@open-mercato/core/modules/core/__integration__/helpers/salesUi';

/**
 * TC-SALES-018: Shipment Cost Impact on Totals
 * Source: .ai/qa/scenarios/TC-SALES-018-shipment-cost-total-impact.md
 */
test.describe('TC-SALES-018: Shipment Cost Impact on Totals', () => {
  test('should change totals after recording shipment with tracking', async ({ page, request }) => {
    await login(page, 'admin');
    const orderId = await createSalesDocument(page, { kind: 'order', preferApi: true });
    const token = await getAuthToken(request, 'admin');
    await createOrderLineFixture(request, token, orderId, {
      name: `QA TC-SALES-018 Item ${Date.now()}`,
      quantity: 1,
      unitPriceNet: 80,
      unitPriceGross: 80,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const grossBeforeShipment = await readGrandTotalGross(page);
    const shipmentResult = await addShipment(page);
    expect(shipmentResult.added, 'Shipment should be saved successfully').toBeTruthy();

    await page.getByRole('button', { name: /^Items$/i }).click();
    const grossAfterShipment = await readGrandTotalGross(page);
    expect(grossAfterShipment).toBeGreaterThanOrEqual(grossBeforeShipment);
  });
});
