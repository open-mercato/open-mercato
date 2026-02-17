import { expect, test } from '@playwright/test';
import { login } from '../../core/__integration__/helpers/auth';
import { addCustomLine, createSalesDocument, readGrandTotalGross } from '../../core/__integration__/helpers/salesUi';

/**
 * TC-SALES-017: Multi-Adjustment Totals Recalculation
 * Source: .ai/qa/scenarios/TC-SALES-017-multi-adjustment-totals.md
 */
test.describe('TC-SALES-017: Multi-Adjustment Totals Recalculation', () => {
  async function submitAdjustment(page: import('@playwright/test').Page, params: {
    label: string;
    kind: 'Discount' | 'Surcharge';
    amount: number;
  }): Promise<void> {
    await page.getByRole('button', { name: /^Adjustments$/i }).click();
    await page.getByRole('button', { name: /Add adjustment/i }).first().click();

    const dialog = page.getByRole('dialog', { name: /Add adjustment/i });
    await expect(dialog).toBeVisible();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await dialog.getByRole('combobox').first().selectOption({ label: params.kind }).catch(() => {});
      await dialog.getByRole('textbox', { name: /e\.g\. Shipping fee/i }).fill(params.label).catch(async () => {
        await dialog.locator('input[placeholder="e.g. Shipping fee"]').first().fill(params.label);
      });

      const amountInputs = dialog.locator('input[placeholder="0.00"]:not([disabled])');
      if ((await amountInputs.count()) > 0) {
        await amountInputs.first().fill(String(params.amount));
      }
      if ((await amountInputs.count()) > 1) {
        await amountInputs.nth(1).fill(String(params.amount));
      }

      await dialog.getByRole('button', { name: /Add adjustment/i }).click();
      const closed = await dialog.waitFor({ state: 'hidden', timeout: 2_500 }).then(() => true).catch(() => false);
      if (closed) return;

      const hasRequiredValidation = await dialog.getByText(/This field is required/i).first().isVisible().catch(() => false);
      if (!hasRequiredValidation) break;
    }
    await expect(dialog).toBeHidden({ timeout: 8_000 });
  }

  test('should recalculate grand total after multiple adjustments', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: `QA TC-SALES-017 Item ${Date.now()}`, quantity: 1, unitPriceGross: 100 });

    const initialGross = await readGrandTotalGross(page);

    await submitAdjustment(page, { label: `QA Fee ${Date.now()}`, kind: 'Surcharge', amount: 15 });
    const grossAfterFee = await readGrandTotalGross(page);
    expect(grossAfterFee).toBeGreaterThan(initialGross);

    await submitAdjustment(page, { label: `QA Discount ${Date.now()}`, kind: 'Discount', amount: 10 });
    const grossAfterDiscount = await readGrandTotalGross(page);
    expect(grossAfterDiscount).toBeLessThan(grossAfterFee);
  });
});
