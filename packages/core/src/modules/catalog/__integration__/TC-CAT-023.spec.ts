import { expect, test } from '@playwright/test';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-023: DB immutability — price history entries cannot be mutated via the API
 * Source: SPEC-033 — Omnibus Price Tracking, Phase 3
 *
 * The history API only exposes GET. This test verifies:
 * 1. POST/DELETE/PUT to the history endpoint return 405 (Method Not Allowed)
 * 2. History entries recorded via price mutations are immutable from the API surface
 */
test.describe('TC-CAT-023: Price History Immutability', () => {
  test('history endpoint rejects POST, DELETE, PUT requests', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let productId: string | null = null;
    let priceId: string | null = null;

    try {
      token = await getAuthToken(request);

      // Get a price kind
      const kindsRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?pageSize=1', { token });
      expect(kindsRes.ok()).toBeTruthy();
      const kindsBody = (await kindsRes.json()) as { items?: { id: string }[] };
      const priceKindId = kindsBody.items?.[0]?.id;
      expect(typeof priceKindId === 'string').toBeTruthy();

      // Create a product + price to generate at least one history entry
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-023 ${stamp}`,
        sku: `QA-CAT-021-${stamp}`,
      });

      const createPriceRes = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: { productId, priceKindId, currencyCode: 'EUR', unitPriceNet: 99 },
      });
      expect(createPriceRes.ok()).toBeTruthy();
      const priceBody = (await createPriceRes.json()) as { id?: string };
      priceId = priceBody.id ?? null;

      // Verify history was recorded
      const historyRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/history?productId=${productId}`,
        { token },
      );
      expect(historyRes.ok()).toBeTruthy();
      const historyBody = (await historyRes.json()) as { items: { id: string }[] };
      expect(historyBody.items.length >= 1).toBeTruthy();
      const entryId = historyBody.items[0]!.id;

      // POST to /api/catalog/prices/history must return 405 (no create endpoint)
      const postRes = await apiRequest(request, 'POST', '/api/catalog/prices/history', {
        token,
        data: { id: entryId, unitPriceNet: '0' },
      });
      expect([405, 404].includes(postRes.status())).toBeTruthy();

      // PUT to /api/catalog/prices/history must return 405 or 404
      const putRes = await apiRequest(request, 'PUT', '/api/catalog/prices/history', {
        token,
        data: { id: entryId, unitPriceNet: '0' },
      });
      expect([405, 404].includes(putRes.status())).toBeTruthy();

      // DELETE to /api/catalog/prices/history must return 405 or 404
      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/prices/history?id=${encodeURIComponent(entryId)}`,
        { token },
      );
      expect([405, 404].includes(deleteRes.status())).toBeTruthy();
    } finally {
      if (token && priceId) {
        await apiRequest(request, 'DELETE', `/api/catalog/prices?id=${encodeURIComponent(priceId)}`, { token }).catch(
          () => {},
        );
      }
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
