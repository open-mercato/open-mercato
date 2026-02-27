import { expect, test } from '@playwright/test';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-026: Phase 5 isPersonalized — standard (non-scoped) price → isPersonalized=false
 * Source: SPEC-033 — Omnibus Price Tracking, Phase 5
 *
 * Full isPersonalized=true test requires a user-group price to be selected as best price,
 * which in turn requires a userId or userGroupId in the pricing context. Standard product
 * list calls without personalization context should return isPersonalized=false.
 */
test.describe('TC-CAT-026: Omnibus — isPersonalized field in products response', () => {
  test('standard (non-scoped) price returns isPersonalized=false in products response', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let productId: string | null = null;
    let priceId: string | null = null;

    try {
      token = await getAuthToken(request);

      // Get a regular price kind
      const kindsRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?pageSize=50', { token });
      expect(kindsRes.ok()).toBeTruthy();
      const kindsBody = (await kindsRes.json()) as { items?: { id: string; isPromotion?: boolean }[] };
      const regularKind = (kindsBody.items ?? []).find((k) => !k.isPromotion);
      expect(regularKind, 'Expected at least one regular price kind').toBeTruthy();
      const priceKindId = regularKind!.id;

      // Create a product
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-026 ${stamp}`,
        sku: `QA-CAT-024-${stamp}`,
      });

      // Create a standard (non-scoped) price
      const createPriceRes = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          priceKindId,
          currencyCode: 'EUR',
          unitPriceNet: 149.99,
          unitPriceGross: 184.99,
        },
      });
      expect(createPriceRes.ok(), `POST price failed: ${createPriceRes.status()}`).toBeTruthy();
      const priceBody = (await createPriceRes.json()) as { id?: string };
      priceId = priceBody.id ?? null;

      // GET products — check isPersonalized field in pricing block
      const productsRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/products?id=${productId}`,
        { token },
      );
      expect(productsRes.ok()).toBeTruthy();
      const productsBody = (await productsRes.json()) as { items?: Record<string, unknown>[] };
      const product = productsBody.items?.find((p) => p.id === productId);
      expect(product, 'Product not found in response').toBeTruthy();

      // pricing block must include isPersonalized and personalizationReason
      if (product?.pricing) {
        const pricing = product.pricing as Record<string, unknown>;
        expect(typeof pricing.is_personalized === 'boolean').toBeTruthy();
        // Standard non-scoped price → isPersonalized must be false
        expect(pricing.is_personalized).toBe(false);
        // personalization_reason must be null for non-personalized price
        expect(pricing.personalization_reason).toBeNull();
      } else {
        // If no pricing resolved (e.g., currency mismatch), just verify fields are expected
        expect(product?.pricing).toBeNull();
      }

      // Verify omnibus field is present (may be null if omnibus disabled)
      expect('omnibus' in (product ?? {})).toBeTruthy();
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
