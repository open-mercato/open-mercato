import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createProductFixture, deleteCatalogProductIfExists } from '@open-mercato/core/helpers/integration/catalogFixtures';
import { createPromotionFixture, deletePromotionIfExists, promotionTreePath, uniqueStamp } from './helpers';

/**
 * TC-PROM-078: `POST /api/promotions/product-page` resolves a real SKU to a
 * badge when a matching `product` rule promotion is active, and an unknown
 * SKU resolves to no badge (never a 500/throw).
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Cart-Facing
 * Endpoints `POST /api/promotions/product-page` + §Implementation Plan
 * Phase 2 step 7.
 */
const PRODUCT_PAGE_PATH = '/api/promotions/product-page';

test.describe('TC-PROM-078: POST /api/promotions/product-page', () => {
  test('badges a real SKU with a matching product-rule promotion; an unknown SKU gets no badge', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;
    let productId: string | null = null;
    const sku = `QA-PROM-078-${stamp}`;
    const unknownSku = `QA-PROM-078-UNKNOWN-${stamp}`;

    try {
      productId = await createProductFixture(request, token, { title: `QA PROM 078 Product ${stamp}`, sku });

      const fixture = await createPromotionFixture(request, token, {
        name: `QA PROM 078 ${stamp}`,
        order: 1,
        active: true,
      });
      promotionId = fixture.id;

      const putTree = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
        token,
        data: {
          updatedAt: fixture.updatedAt,
          root: {
            id: fixture.rootGroupId,
            operator: 'and',
            sortOrder: 0,
            rules: [{ ruleType: 'product', config: { productId, variantId: null, quantity: 1, operator: 'gte' } }],
            benefits: [
              {
                benefitType: 'cart_discount',
                appliesTo: 'order',
                config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: 'Badge promo' } },
              },
            ],
            children: [],
          },
        },
      });
      expect(putTree.status(), 'tree PUT should succeed').toBe(200);

      const response = await apiRequest(request, 'POST', PRODUCT_PAGE_PATH, {
        token,
        data: { skus: [sku, unknownSku] },
      });
      expect(response.status(), 'product-page should return 200, never a 500/throw on an unknown SKU').toBe(200);
      const body = await readJsonSafe<{ badges: Array<{ sku: string; promotionId: string; promotionName: string }> }>(response);

      const matchedBadges = (body?.badges ?? []).filter((badge) => badge.sku === sku);
      expect(matchedBadges.length, 'the real SKU should get at least one badge').toBeGreaterThan(0);
      expect(matchedBadges.some((badge) => badge.promotionId === promotionId)).toBe(true);

      const unknownBadges = (body?.badges ?? []).filter((badge) => badge.sku === unknownSku);
      expect(unknownBadges, 'an unknown SKU must not receive a badge').toHaveLength(0);
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
      await deleteCatalogProductIfExists(request, token, productId);
    }
  });
});
