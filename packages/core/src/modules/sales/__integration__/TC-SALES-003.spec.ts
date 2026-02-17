import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { createSalesDocument } from './helpers/salesUi';

/**
 * TC-SALES-003: Order Creation
 * Source: .ai/qa/scenarios/TC-SALES-003-order-creation.md
 */
test.describe('TC-SALES-003: Order Creation', () => {
  test('should create a sales order from UI create form', async ({ page }) => {
    await login(page, 'admin');
    const orderId = await createSalesDocument(page, { kind: 'order' });

    expect(orderId).toMatch(/[0-9a-f-]{36}/i);
    await expect(page.getByText('Sales order', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /ORDER-/i })).toBeVisible();
  });
});
