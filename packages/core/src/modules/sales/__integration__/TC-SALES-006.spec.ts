import { expect, test, type Page } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createOrderLineFixture,
  createSalesOrderFixture,
  deleteSalesEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures';

async function openOrderDetail(page: Page, orderId: string, lineName: string): Promise<void> {
  const orderUrl = `/backend/sales/documents/${orderId}?kind=order`;
  const lineRow = page.getByRole('row', { name: new RegExp(lineName, 'i') });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.goto(orderUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText(/Loading document|Loading/i).first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    if (await lineRow.isVisible().catch(() => false)) return;

    const retryButton = page.getByRole('button', { name: /Try again/i }).first();
    if (await retryButton.isVisible().catch(() => false)) {
      await retryButton.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.getByText(/Loading document|Loading/i).first().waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
      if (await lineRow.isVisible().catch(() => false)) return;
    }
  }

  await expect(lineRow).toBeVisible({ timeout: 20_000 });
}

/**
 * TC-SALES-006: Order Tax Calculation
 * Source: .ai/qa/scenarios/TC-SALES-006-order-tax-calculation.md
 */
test.describe('TC-SALES-006: Order Tax Calculation', () => {
  test('should display tax-aware net/gross amounts on order line in UI', async ({ page, request }) => {
    test.slow();
    test.setTimeout(120_000);
    const lineName = `QA TC-SALES-006 ${Date.now()}`;
    const token = await getAuthToken(request, 'admin');
    let orderId: string | null = null;
    let lineId: string | null = null;

    try {
      orderId = await createSalesOrderFixture(request, token, 'USD');
      lineId = await createOrderLineFixture(request, token, orderId, {
        name: lineName,
        quantity: 1,
        unitPriceNet: 100,
        unitPriceGross: 123,
        taxRate: 23,
        currencyCode: 'USD',
      });

      await login(page, 'admin');
      await openOrderDetail(page, orderId, lineName);

      const row = page.getByRole('row', { name: new RegExp(lineName, 'i') });
      await expect(row).toContainText(/(?:\$|USD\s*)123\.00 gross/, { timeout: 20_000 });
      await expect(row).toContainText(/(?:\$|USD\s*)100\.00 net/, { timeout: 20_000 });
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/order-lines', lineId);
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId);
    }
  });
});
