import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import {
  addAdjustment,
  addCustomLine,
  createSalesDocument,
  readGrandTotalGross,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesUi';

/**
 * TC-SALES-017: Multi-Adjustment Totals Recalculation
 * Source: .ai/qa/scenarios/TC-SALES-017-multi-adjustment-totals.md
 */
test.describe('TC-SALES-017: Multi-Adjustment Totals Recalculation', () => {
  test('should recalculate grand total after multiple adjustments', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA TC-SALES-017 Item ${Date.now()}`, quantity: 1, unitPriceGross: 100 });

    const initialGross = await readGrandTotalGross(page);

    await addAdjustment(page, { label: `QA Fee ${Date.now()}`, kindLabel: 'Surcharge', netAmount: 15 });
    const grossAfterFee = await readGrandTotalGross(page);
    expect(grossAfterFee).toBeGreaterThan(initialGross);

    await addAdjustment(page, { label: `QA Discount ${Date.now()}`, kindLabel: 'Discount', netAmount: 10 });
    const grossAfterDiscount = await readGrandTotalGross(page);
    expect(grossAfterDiscount).toBeLessThan(grossAfterFee);
  });
});
