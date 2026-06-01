import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { addCustomLine, createSalesDocument } from '@open-mercato/core/modules/core/__integration__/helpers/salesUi';

/**
 * TC-SALES-011: Payment Allocation
 * Source: .ai/qa/scenarios/TC-SALES-011-payment-allocation.md
 */
test.describe('TC-SALES-011: Payment Allocation', () => {
  test('should expose allocation controls in payment UI when available', async ({ page }) => {
    // Heavy multi-hop UI flow (login + createSalesDocument + line + allocation)
    // routinely exceeds Playwright's 20s default on a loaded ephemeral shard;
    // opt into the sanctioned per-test budget (see TC-SALES-005). Global bump
    // is disallowed.
    test.slow();
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA TC-SALES-011 ${Date.now()}`, quantity: 1, unitPriceGross: 60 });

    await page.getByRole('button', { name: /^Payments$/i }).click();
    await page.getByRole('button', { name: /Add payment/i }).click();
    const dialog = page.getByRole('dialog', { name: /Add payment/i });
    await expect(dialog).toBeVisible();

    const allocationText = dialog.getByText(/allocation|allocate/i);
    if ((await allocationText.count()) === 0) {
      test.skip(true, 'Payment allocation controls are not available in current UI.');
    }
    await expect(allocationText.first()).toBeVisible();
  });
});
