import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { addCustomLine, addPayment, createSalesDocument, readGrandTotalGross } from '@open-mercato/core/modules/core/__integration__/helpers/salesUi';

/**
 * TC-SALES-019: Payment Entry and Grand Total Stability
 * Source: .ai/qa/scenarios/TC-SALES-019-payment-entry-total-stability.md
 */
test.describe('TC-SALES-019: Payment Entry and Grand Total Stability', () => {
  test('should keep grand total stable after payment is recorded', async ({ page }) => {
    // Multi-hop UI orchestration (login + createSalesDocument + addCustomLine
    // + readGrandTotalGross + addPayment + readGrandTotalGross) regularly
    // exceeds Playwright's 20s default budget on a cold ephemeral DB. Each
    // helper waits up to TEST_WAIT_TIMEOUT_MS=10s for stable visibility.
    // Per-test opt-in is the documented escape hatch; raising the global
    // timeout in playwright.config.ts is rejected by project policy.
    test.slow();

    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA TC-SALES-019 Item ${Date.now()}`, quantity: 1, unitPriceGross: 60 });

    const grossBeforePayment = await readGrandTotalGross(page);
    const paymentResult = await addPayment(page, 20);
    expect(paymentResult.added, 'Payment should be saved successfully').toBeTruthy();

    const grossAfterPayment = await readGrandTotalGross(page);
    expect(grossAfterPayment).toBe(grossBeforePayment);
  });
});
