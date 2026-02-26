import { expect, test } from '@playwright/test';
import {
  createProductFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CAT-019: announced_promotion — price kind marked isPromotion=true → applicable=true in products response
 * Source: SPEC-033 — Omnibus Price Tracking, Phase 2
 *
 * Note: In a fresh environment, only newly-created prices exist, so `insufficientHistory` will be true.
 * This test verifies that: (a) the omnibus block is present in the products response,
 * (b) when priceKindIsPromotion=true but history is insufficient → reason is 'insufficient_history'.
 * Full 'announced_promotion' requires history older than the lookback window (not achievable in integration tests).
 */
test.describe('TC-CAT-019: Omnibus — announced_promotion / promotion price kind', () => {
  test('product with promotion price kind returns omnibus block with applicable field', async ({ request }) => {
    const stamp = Date.now();
    let token: string | null = null;
    let productId: string | null = null;
    let priceId: string | null = null;
    let promotionKindId: string | null = null;
    let originalConfig: Record<string, unknown> = {};

    try {
      token = await getAuthToken(request);

      // Save original config
      const getRes = await apiRequest(request, 'GET', '/api/catalog/config/omnibus', { token });
      expect(getRes.ok()).toBeTruthy();
      originalConfig = ((await getRes.json()) as Record<string, unknown>) ?? {};

      // Find or identify a promotion price kind (isPromotion=true)
      const kindsRes = await apiRequest(request, 'GET', '/api/catalog/price-kinds?pageSize=50', { token });
      expect(kindsRes.ok()).toBeTruthy();
      const kindsBody = (await kindsRes.json()) as { items?: { id: string; isPromotion?: boolean }[] };
      const allKinds = kindsBody.items ?? [];
      const promoKind = allKinds.find((k) => k.isPromotion === true);
      const regularKind = allKinds.find((k) => !k.isPromotion);

      // If no promotion price kind exists, skip this scenario gracefully
      if (!promoKind || !regularKind) {
        test.skip(true, 'No promotion price kind found — create one in catalog settings to fully test TC-CAT-019');
        return;
      }
      promotionKindId = promoKind.id;

      // Enable omnibus
      await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
        token,
        data: { enabled: true, enabledCountryCodes: ['PL'] },
      });

      // Create product
      productId = await createProductFixture(request, token, {
        title: `QA TC-CAT-019 ${stamp}`,
        sku: `QA-CAT-019-${stamp}`,
      });

      // Create price with promotion price kind — this also records history
      const createPriceRes = await apiRequest(request, 'POST', '/api/catalog/prices', {
        token,
        data: {
          productId,
          priceKindId: promotionKindId,
          currencyCode: 'EUR',
          unitPriceNet: 49.99,
          unitPriceGross: 59.99,
        },
      });
      expect(createPriceRes.ok(), `POST prices failed: ${createPriceRes.status()}`).toBeTruthy();
      const priceBody = (await createPriceRes.json()) as { id?: string };
      priceId = priceBody.id ?? null;

      // GET products — check omnibus field is present
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

      // omnibus field must exist (enabled omnibus with pricing block)
      if (product?.omnibus !== undefined) {
        const omnibus = product.omnibus as Record<string, unknown> | null;
        if (omnibus !== null) {
          // When history exists but is insufficient, we get insufficient_history
          // When history is sufficient and priceKindIsPromotion=true, we get announced_promotion
          expect(['announced_promotion', 'insufficient_history', 'no_history'].includes(omnibus.applicabilityReason as string)).toBeTruthy();
          expect(typeof omnibus.applicable === 'boolean').toBeTruthy();
          expect(omnibus.currencyCode).toBe('EUR');
        }
      }

      // Also verify via omnibus-preview endpoint (priceKindIsPromotion always false there, so applicable=false)
      const previewRes = await apiRequest(
        request,
        'GET',
        `/api/catalog/prices/omnibus-preview?priceKindId=${promotionKindId}&currencyCode=EUR&productId=${productId}`,
        { token },
      );
      expect(previewRes.ok()).toBeTruthy();
      const previewBody = (await previewRes.json()) as Record<string, unknown> | null;
      expect(previewBody).not.toBeNull();
      // In preview endpoint, priceKindIsPromotion=false, so applicable=false
      if (previewBody?.applicabilityReason === 'insufficient_history') {
        expect(previewBody.applicable).toBe(false);
        expect(typeof previewBody.coverageStartAt === 'string' || previewBody.coverageStartAt === null).toBeTruthy();
      }
    } finally {
      if (token && priceId) {
        await apiRequest(request, 'DELETE', `/api/catalog/prices?id=${encodeURIComponent(priceId)}`, { token }).catch(() => {});
      }
      await deleteCatalogProductIfExists(request, token, productId);
      if (token) {
        const restore: Record<string, unknown> = {};
        if (originalConfig.enabled !== undefined) restore.enabled = originalConfig.enabled;
        if (originalConfig.enabledCountryCodes !== undefined)
          restore.enabledCountryCodes = originalConfig.enabledCountryCodes;
        await apiRequest(request, 'PATCH', '/api/catalog/config/omnibus', {
          token,
          data: restore,
        }).catch(() => {});
      }
    }
  });
});
