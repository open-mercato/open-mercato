import { expect, test } from '@playwright/test';
import { login } from '../../core/__integration__/helpers/auth';
import { addAdjustment, addCustomLine, createSalesDocument } from '../../core/__integration__/helpers/salesUi';

/**
 * TC-SALES-005: Order Discount Adjustment
 * Source: .ai/qa/scenarios/TC-SALES-005-order-discount-adjustment.md
 */
test.describe('TC-SALES-005: Order Discount Adjustment', () => {
  test('should add discount adjustment on order from UI', async ({ page }) => {
    const adjustmentLabel = `QA Discount ${Date.now()}`;

    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA Item ${Date.now()}`, quantity: 1, unitPriceGross: 50 });
    await addAdjustment(page, { label: adjustmentLabel, kindLabel: 'Discount', netAmount: 5 });

    await expect(page.getByRole('row', { name: new RegExp(adjustmentLabel, 'i') })).toBeVisible();
    await expect(page.getByText('Discount', { exact: true })).toBeVisible();
  });
});
