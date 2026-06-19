import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { addAdjustment, addCustomLine, createSalesDocument } from '@open-mercato/core/modules/core/__integration__/helpers/salesUi';

/**
 * TC-SALES-005: Order Discount Adjustment
 * Source: .ai/qa/scenarios/TC-SALES-005-order-discount-adjustment.md
 */
test.describe('TC-SALES-005: Order Discount Adjustment', () => {
  test('should add discount adjustment on order from UI', async ({ page }) => {
    // Multi-hop UI orchestration (login + createSalesDocument + addCustomLine
    // + addAdjustment) regularly exceeds Playwright's 20s default budget on
    // a cold ephemeral DB. Each helper waits up to TEST_WAIT_TIMEOUT_MS=10s
    // for stable visibility. Per-test opt-in is the documented escape hatch;
    // raising the global timeout in playwright.config.ts is rejected by
    // project policy.
    test.slow();

    const adjustmentLabel = `QA Discount ${Date.now()}`;

    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA Item ${Date.now()}`, quantity: 1, unitPriceGross: 50 });
    await addAdjustment(page, { label: adjustmentLabel, kindLabel: 'Discount', netAmount: 5 });

    await expect(page.getByRole('row', { name: new RegExp(adjustmentLabel, 'i') })).toBeVisible();
    await expect(page.getByText('Discount', { exact: true })).toBeVisible();
  });
});
