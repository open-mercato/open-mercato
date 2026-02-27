import { expect, test } from '@playwright/test';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-016: GET /api/catalog/prices/history — Filtering and Pagination
 * Source: SPEC-033 — Omnibus Price Tracking, API Contracts section
 */
test.describe('TC-CAT-016: Price History API — Filtering and Pagination', () => {
  test('should filter history by productId and support includeTotal', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let productId: string | null = null;
    let priceKindId: string | null = null;
    const createdPriceIds: string[] = [];

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-016 ${stamp}`,
        sku: `QA-CAT-014-${stamp}`,
      });

      // Resolve first price kind
      const kindsRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?pageSize=1', { token });
      expect(kindsRes.ok()).toBeTruthy();
      const kindsBody = (await kindsRes.json()) as { items?: { id: string }[] };
      expect(Array.isArray(kindsBody.items) && kindsBody.items.length > 0).toBeTruthy();
      priceKindId = kindsBody.items![0]!.id;

      // Create two prices for the same product
      for (const net of [50, 60]) {
        const res = await apiRequest(request, 'POST', '/api/catalog/prices', {
          token,
          data: {
            productId,
            priceKindId,
            currencyCode: 'EUR',
            unitPriceNet: net,
          },
        });
        expect(res.ok(), `POST prices failed: ${res.status()}`).toBeTruthy();
        const body = (await res.json()) as { id?: string };
        if (body.id) createdPriceIds.push(body.id);
      }

      // Query history filtered by productId — must include our entries
      const historyRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/history?productId=${productId}&includeTotal=true`,
        { token },
      );
      expect(historyRes.ok()).toBeTruthy();
      const historyBody = (await historyRes.json()) as {
        items: { productId: string; changeType: string }[];
        nextCursor: string | null;
        total?: number;
      };
      expect(Array.isArray(historyBody.items)).toBeTruthy();
      expect(historyBody.items.length >= 2, 'Expected at least 2 history entries for 2 created prices').toBeTruthy();
      for (const item of historyBody.items) {
        expect(item.productId).toBe(productId);
      }

      // total must be included when includeTotal=true
      expect(typeof historyBody.total === 'number', 'Expected total field when includeTotal=true').toBeTruthy();
      expect(historyBody.total! >= 2).toBeTruthy();

      // changeType filter — only 'create' entries
      const createOnlyRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/history?productId=${productId}&changeType=create`,
        { token },
      );
      expect(createOnlyRes.ok()).toBeTruthy();
      const createOnlyBody = (await createOnlyRes.json()) as { items: { changeType: string }[] };
      for (const item of createOnlyBody.items) {
        expect(item.changeType).toBe('create');
      }

      // pageSize=1 should return at most 1 item
      const pagedRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/history?productId=${productId}&pageSize=1`,
        { token },
      );
      expect(pagedRes.ok()).toBeTruthy();
      const pagedBody = (await pagedRes.json()) as { items: unknown[]; nextCursor: string | null };
      expect(pagedBody.items.length).toBe(1);
      expect(typeof pagedBody.nextCursor === 'string', 'Expected a nextCursor when more pages exist').toBeTruthy();
    } finally {
      for (const id of createdPriceIds) {
        await apiRequest(request, 'DELETE', `/api/catalog/prices?id=${encodeURIComponent(id)}`, { token: token! }).catch(() => {});
      }
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
