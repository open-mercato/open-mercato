import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';

/**
 * TC-CAT-ATOMIC-001: product writes roll back fully on failure (#2338, part of #2333).
 *
 * Guards the create path in `catalog.products`, where the scalar product flush
 * and the offers/categories/tags sync now run inside one transaction. Before the
 * fix a failure after the product insert could leave an orphan product or stray
 * relations committed.
 *
 * The failure is injected with a real unique-handle constraint violation; the
 * request also carries tags so a non-atomic create would have extra surface to
 * leak. We then assert no partial product survives the rollback.
 */
test.describe('TC-CAT-ATOMIC-001: product create rolls back fully on failure', () => {
  test('a create rejected by a duplicate handle persists no partial product', async ({ request }) => {
    let token: string | null = null;
    let firstProductId: string | null = null;
    const suffix = Math.random().toString(36).slice(2, 10);
    const handle = `qa-atomic-${suffix}`;
    const orphanSku = `QA-ATOMIC-SKU2-${suffix}`;
    const description = 'Long enough description for QA automation atomicity flows in the catalog module.';

    try {
      token = await getAuthToken(request, 'admin');

      const firstRes = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: { title: 'QA Atomic P1', sku: `QA-ATOMIC-SKU1-${suffix}`, handle, description },
      });
      expect(firstRes.status(), 'first product created').toBe(201);
      firstProductId = ((await firstRes.json()) as { id: string }).id;

      // Reuse the handle (unique) and attach tags so the rejected create has
      // multi-table work to leak if it were not transactional.
      const dupRes = await apiRequest(request, 'POST', '/api/catalog/products', {
        token,
        data: {
          title: 'QA Atomic P2',
          sku: orphanSku,
          handle,
          description,
          tags: [`qa-atomic-tag-${suffix}`],
          offers: [],
        },
      });
      expect(dupRes.status(), 'duplicate handle rejected').toBeGreaterThanOrEqual(400);

      // The rolled-back create must leave no product row behind.
      const searchRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?search=${encodeURIComponent(orphanSku)}&pageSize=100`,
        { token },
      );
      expect(searchRes.status()).toBe(200);
      const items = ((await searchRes.json()) as { items?: Array<{ sku?: string | null }> }).items ?? [];
      expect(items.filter((item) => item.sku === orphanSku).length, 'no partial product persisted after rollback').toBe(0);
    } finally {
      await deleteCatalogProductIfExists(request, token, firstProductId);
    }
  });
});
