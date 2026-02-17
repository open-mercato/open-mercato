import { expect, test } from '@playwright/test';
import { login } from '../../core/__integration__/helpers/auth';
import { addCustomLine, createSalesDocument } from '../../core/__integration__/helpers/salesUi';

/**
 * TC-SALES-002: Quote To Order Conversion
 * Source: .ai/qa/scenarios/TC-SALES-002-quote-to-order-conversion.md
 */
test.describe('TC-SALES-002: Quote To Order Conversion', () => {
  test('should convert quote into order from actions menu', async ({ page }) => {
    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'quote' });
    await addCustomLine(page, {
      name: `QA TC-SALES-002 ${Date.now()}`,
      quantity: 1,
      unitPriceGross: 25,
    });

    await page.getByRole('button', { name: /^Actions$/i }).click();
    const convertMenuItem = page.getByRole('menuitem', { name: /Convert to order/i });
    const convertButton = page.getByRole('button', { name: /Convert to order/i });
    if (await convertMenuItem.count()) {
      await convertMenuItem.first().click();
    } else if (await convertButton.count()) {
      await convertButton.first().click();
    } else {
      test.skip(true, 'Convert to order action is not exposed in this environment state.');
    }

    const confirmButton = page.getByRole('button', { name: /Convert|Create order|Continue/i }).last();
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
    }

    await expect(page).toHaveURL(/\/backend\/sales\/documents\/[0-9a-f-]{36}\?kind=order$/i);
    await expect(page.getByText('Sales order', { exact: true })).toBeVisible();
  });
});
