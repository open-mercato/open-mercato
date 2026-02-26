import { expect, test } from '@playwright/test';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-013: Price History Recorded on Create / Update / Delete
 * Source: SPEC-033 — Omnibus Price Tracking, Phase 1 integration requirements
 */
test.describe('TC-CAT-013: Price History Recorded on Create / Update / Delete', () => {
  test('should record a history entry for each price mutation', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let productId: string | null = null;
    let priceKindId: string | null = null;
    let priceId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-013 ${stamp}`,
        sku: `QA-CAT-013-${stamp}`,
      });

      // Resolve the first available price kind
      const kindsRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?pageSize=1', { token });
      expect(kindsRes.ok(), `GET price-kinds failed: ${kindsRes.status()}`).toBeTruthy();
      const kindsBody = (await kindsRes.json()) as { items?: { id: string; code: string }[] };
      expect(Array.isArray(kindsBody.items) && kindsBody.items.length > 0).toBeTruthy();
      priceKindId = kindsBody.items![0]!.id;

      // Create a price
      const createRes = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          priceKindId,
          currencyCode: 'USD',
          unitPriceNet: 99,
        },
      });
      expect(createRes.ok(), `POST prices failed: ${createRes.status()}`).toBeTruthy();
      const createBody = (await createRes.json()) as { id?: string };
      priceId = createBody.id ?? null;
      expect(typeof priceId === 'string' && priceId.length > 0).toBeTruthy();

      // Verify a 'create' history entry exists
      const historyAfterCreate = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/history?productId=${productId}&changeType=create`,
        { token },
      );
      expect(historyAfterCreate.ok()).toBeTruthy();
      const historyCreateBody = (await historyAfterCreate.json()) as {
        items: { id: string; priceId: string; changeType: string; productId: string }[];
      };
      const createEntry = historyCreateBody.items.find((e) => e.priceId === priceId && e.changeType === 'create');
      expect(createEntry, 'Expected a create history entry for the new price').toBeTruthy();
      expect(createEntry!.productId).toBe(productId);

      // Update the price
      const updateRes = await apiRequest(request, 'PUT', '/api/catalog/prices', {
        token,
        data: { id: priceId, unitPriceNet: 79 },
      });
      expect(updateRes.ok(), `PUT prices failed: ${updateRes.status()}`).toBeTruthy();

      // Verify an 'update' history entry exists
      const historyAfterUpdate = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/history?productId=${productId}&changeType=update`,
        { token },
      );
      expect(historyAfterUpdate.ok()).toBeTruthy();
      const historyUpdateBody = (await historyAfterUpdate.json()) as {
        items: { priceId: string; changeType: string }[];
      };
      const updateEntry = historyUpdateBody.items.find((e) => e.priceId === priceId && e.changeType === 'update');
      expect(updateEntry, 'Expected an update history entry after price update').toBeTruthy();

      // Delete the price
      const deleteRes = await apiRequest(
        request,
        'DELETE',
        `/api/catalog/prices?id=${encodeURIComponent(priceId!)}`,
        { token },
      );
      expect(deleteRes.ok(), `DELETE price failed: ${deleteRes.status()}`).toBeTruthy();
      priceId = null;

      // Verify a 'delete' history entry exists
      const historyAfterDelete = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/history?productId=${productId}&changeType=delete`,
        { token },
      );
      expect(historyAfterDelete.ok()).toBeTruthy();
      const historyDeleteBody = (await historyAfterDelete.json()) as {
        items: { changeType: string }[];
      };
      expect(historyDeleteBody.items.length > 0, 'Expected a delete history entry after price deletion').toBeTruthy();
    } finally {
      if (token && priceId) {
        await apiRequest(request, 'DELETE', `/api/catalog/prices?id=${encodeURIComponent(priceId)}`, { token }).catch(() => {});
      }
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
