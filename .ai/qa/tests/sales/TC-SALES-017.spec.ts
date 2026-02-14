import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { addAdjustment, addCustomLine, createSalesDocument, readGrandTotalGross } from '../helpers/salesUi';

/**
 * TC-SALES-017: Multi-Adjustment Totals Recalculation
 * Source: .ai/qa/scenarios/TC-SALES-017-multi-adjustment-totals.md
 */
test.describe('TC-SALES-017: Multi-Adjustment Totals Recalculation', () => {
  test('should recalculate grand total after multiple adjustments', async ({ page }) => {
    const feeLabel = `QA Fee ${Date.now()}`;
    const discountLabel = `QA Discount ${Date.now()}`;

    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA TC-SALES-017 Item ${Date.now()}`, quantity: 1, unitPriceGross: 100 });

    const initialGross = await readGrandTotalGross(page);

    await addAdjustment(page, { label: feeLabel, netAmount: 15 });
    const grossAfterFee = await readGrandTotalGross(page);
    expect(grossAfterFee).toBeGreaterThan(initialGross);

    await addAdjustment(page, { label: discountLabel, kindLabel: 'Discount', netAmount: 10 });
    const grossAfterDiscount = await readGrandTotalGross(page);
    expect(grossAfterDiscount).toBeLessThan(grossAfterFee);

    await expect(page.getByRole('row', { name: new RegExp(feeLabel, 'i') })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(discountLabel, 'i') })).toBeVisible();
  });
});
