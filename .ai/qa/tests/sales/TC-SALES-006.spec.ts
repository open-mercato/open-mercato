import { expect, test } from '@playwright/test';
import { login } from '../helpers/auth';
import { addCustomLine, createSalesDocument } from '../helpers/salesUi';

/**
 * TC-SALES-006: Order Tax Calculation
 * Source: .ai/qa/scenarios/TC-SALES-006-order-tax-calculation.md
 */
test.describe('TC-SALES-006: Order Tax Calculation', () => {
  test('should display tax-aware net/gross amounts on order line in UI', async ({ page }) => {
    const lineName = `QA TC-SALES-006 ${Date.now()}`;

    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, {
      name: lineName,
      quantity: 1,
      unitPriceGross: 123,
      taxClassName: '23% VAT • VAT-23 • 23%',
    });

    const row = page.getByRole('row', { name: new RegExp(lineName, 'i') });
    await expect(row).toContainText('$123.00 gross');
    await expect(row).toContainText('$123.00 net');
  });
});
