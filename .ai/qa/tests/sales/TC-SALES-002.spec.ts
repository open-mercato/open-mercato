import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import { createSalesQuoteFixture, deleteSalesEntityIfExists } from '../helpers/salesFixtures';

/**
 * TC-SALES-002: Quote To Order Conversion
 * Source: .ai/qa/scenarios/TC-SALES-002-quote-to-order-conversion.md
 */
test.describe('TC-SALES-002: Quote To Order Conversion', () => {
  test('should convert quote into order', async ({ request }) => {
    let token: string | null = null;
    let quoteId: string | null = null;
    let orderId: string | null = null;

    try {
      token = await getAuthToken(request);
      quoteId = await createSalesQuoteFixture(request, token, 'USD');

      const convertResponse = await apiRequest(request, 'POST', '/api/sales/quotes/convert', {
        token,
        data: { quoteId },
      });
      expect(convertResponse.ok()).toBeTruthy();
      const convertBody = (await convertResponse.json()) as { orderId?: string };
      orderId = convertBody.orderId ?? null;
      expect(orderId).toBeTruthy();
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId);
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId);
    }
  });
});

