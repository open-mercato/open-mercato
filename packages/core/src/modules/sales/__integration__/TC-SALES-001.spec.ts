import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { addCustomLine, createSalesDocument } from './helpers/salesUi';

/**
 * TC-SALES-001: Quote Creation
 * Source: .ai/qa/scenarios/TC-SALES-001-quote-creation.md
 */
test.describe('TC-SALES-001: Quote Creation', () => {
  test('should create a quote and add a line from UI', async ({ page }) => {
    const lineName = `QA TC-SALES-001 ${Date.now()}`;

    await login(page, 'admin');
    const quoteId = await createSalesDocument(page, { kind: 'quote' });
    await addCustomLine(page, {
      name: lineName,
      quantity: 2,
      unitPriceGross: 30,
    });

    expect(quoteId).toMatch(/[0-9a-f-]{36}/i);
    const row = page.getByRole('row', { name: new RegExp(lineName, 'i') });
    await expect(row).toBeVisible();
    await expect(row).toContainText('$60.00 gross');
  });
});
