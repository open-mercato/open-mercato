import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { addCustomLine, createSalesDocument, updateLineQuantity } from './helpers/salesUi';

/**
 * TC-SALES-004: Order Line Management
 * Source: .ai/qa/scenarios/TC-SALES-004-order-line-management.md
 */
test.describe('TC-SALES-004: Order Line Management', () => {
  test('should create and update order line in UI', async ({ page }) => {
    const lineName = `QA TC-SALES-004 ${Date.now()}`;

    await login(page, 'admin');
    await createSalesDocument(page, { kind: 'order' });
    await addCustomLine(page, { name: lineName, quantity: 2, unitPriceGross: 13 });
    await updateLineQuantity(page, lineName, 5);
    await expect(page.getByRole('row', { name: new RegExp(`${lineName}.*\\b5\\b`, 'i') })).toBeVisible();
  });
});
