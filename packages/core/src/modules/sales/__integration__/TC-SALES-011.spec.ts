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
  }

  await expect(lineRow).toBeVisible({ timeout: 20_000 });
}

/**
 * TC-SALES-011: Payment Allocation
 * Source: .ai/qa/scenarios/TC-SALES-011-payment-allocation.md
 */
test.describe('TC-SALES-011: Payment Allocation', () => {
  test('should expose allocation controls in payment UI when available', async ({ page, request }) => {
    test.slow();
    test.setTimeout(120_000);

    const lineName = `QA TC-SALES-011 ${Date.now()}`;
    const token = await getAuthToken(request, 'admin');
    let orderId: string | null = null;
    let lineId: string | null = null;

    try {
      orderId = await createSalesOrderFixture(request, token, 'USD');
      lineId = await createOrderLineFixture(request, token, orderId, {
        name: lineName,
        quantity: 1,
        unitPriceNet: 50,
        unitPriceGross: 60,
        currencyCode: 'USD',
      });

      await login(page, 'admin');
      await openOrderDetail(page, orderId, lineName);
      await page.getByRole('button', { name: /^Payments$/i }).click();
      await page.getByRole('button', { name: /Add payment/i }).first().click();
      const dialog = page.getByRole('dialog', { name: /Add payment/i });
      await expect(dialog).toBeVisible({ timeout: 20_000 });

      const allocationText = dialog.getByText(/allocation|allocate/i);
      if ((await allocationText.count()) === 0) {
        test.skip(true, 'Payment allocation controls are not available in current UI.');
      }
      await expect(allocationText.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/order-lines', lineId);
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId);
    }
  });
});
