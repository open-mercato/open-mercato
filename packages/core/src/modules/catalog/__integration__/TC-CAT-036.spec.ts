import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';

/**
 * TC-CAT-036: Product search is accent-insensitive
 * Regression coverage for https://github.com/open-mercato/open-mercato/issues/6074 —
 * `GET /api/catalog/products?search=` folded case but not diacritics, so an
 * unaccented query like "hustawka" missed a product titled "huśtawka".
 */
test.describe('TC-CAT-036: Product search is accent-insensitive', () => {
  test('matches accented, unaccented, and uppercase queries to the same product', async ({ request }) => {
    const stamp = Date.now();
    const productTitle = `QA TC-CAT-036 huśtawka ${stamp}`;
    const sku = `QA-CAT-036-${stamp}`;
    let token: string | null = null;
    let productId: string | null = null;

    try {
      token = await getAuthToken(request);
      productId = await createProductFixture(request, token, { title: productTitle, sku });

      const queries = [
        `hustawka ${stamp}`,
        `huśtawka ${stamp}`,
        `HUSTAWKA ${stamp}`,
        `HUŚTAWKA ${stamp}`,
      ];

      for (const search of queries) {
        const response = await apiRequest(
          request,
          'GET',
          `/api/catalog/products?search=${encodeURIComponent(search)}`,
          { token },
        );
        expect(response.ok(), `Search request failed for "${search}": ${response.status()}`).toBeTruthy();
        const body = (await response.json()) as { items?: Array<{ id?: string }> };
        const ids = (body.items ?? []).map((item) => item.id);
        expect(ids, `Search for "${search}" did not return the fixture product`).toContain(productId);
      }
    } finally {
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
