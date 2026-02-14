import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '../helpers/api';
import { createSalesQuoteFixture, deleteSalesEntityIfExists } from '../helpers/salesFixtures';

/**
 * TC-SALES-001: Quote Creation
 * Source: .ai/qa/scenarios/TC-SALES-001-quote-creation.md
 */
test.describe('TC-SALES-001: Quote Creation', () => {
  test('should create a quote and add a quote line', async ({ request }) => {
    let token: string | null = null;
    let quoteId: string | null = null;
    let lineId: string | null = null;

    try {
      token = await getAuthToken(request);
      quoteId = await createSalesQuoteFixture(request, token, 'USD');

      const lineResponse = await apiRequest(request, 'POST', '/api/sales/quote-lines', {
        token,
        data: {
          quoteId,
          currencyCode: 'USD',
          quantity: 2,
          name: `QA quote line ${Date.now()}`,
          unitPriceNet: 25,
          unitPriceGross: 30,
        },
      });
      expect(lineResponse.ok()).toBeTruthy();
      const lineBody = (await lineResponse.json()) as { id?: string };
      lineId = lineBody.id ?? null;
      expect(lineId).toBeTruthy();

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/sales/quote-lines?quoteId=${encodeURIComponent(quoteId)}`,
        { token },
      );
      expect(listResponse.ok()).toBeTruthy();
      const listBody = (await listResponse.json()) as { items?: Array<{ id?: string }> };
      const hasLine = Array.isArray(listBody.items) && listBody.items.some((item) => item.id === lineId);
      expect(hasLine).toBeTruthy();
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quote-lines', lineId);
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId);
    }
  });
});

