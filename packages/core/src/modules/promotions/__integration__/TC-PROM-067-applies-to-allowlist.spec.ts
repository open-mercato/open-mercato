import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPromotionFixture, deletePromotionIfExists, promotionTreePath, uniqueStamp } from './helpers';

/**
 * TC-PROM-067: the `applies_to` allow-list is enforced at the write path, not
 * merely documented — `cart_discount` only allows `order`, `product_discount`
 * only allows `line`/`unit`. Either combination is rejected 422.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §B.9 (TC-PROM-067).
 */
test.describe('TC-PROM-067: applies_to allow-list rejection', () => {
  test('cart_discount with appliesTo "unit" is rejected 422', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, { name: `QA PROM 067a ${stamp}`, order: 1 });
      promotionId = fixture.id;

      const response = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
        token,
        data: {
          updatedAt: fixture.updatedAt,
          root: {
            id: fixture.rootGroupId,
            operator: 'and',
            sortOrder: 0,
            rules: [],
            benefits: [
              {
                benefitType: 'cart_discount',
                appliesTo: 'unit',
                config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: 'x' } },
              },
            ],
            children: [],
          },
        },
      });
      expect(response.status(), 'cart_discount with appliesTo unit should be rejected 422').toBe(422);
      const body = await readJsonSafe<Record<string, unknown>>(response);
      expect(Array.isArray((body as { issues?: unknown[] })?.issues)).toBe(true);
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
    }
  });

  test('product_discount with appliesTo "order" is rejected 422', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, { name: `QA PROM 067b ${stamp}`, order: 1 });
      promotionId = fixture.id;

      const response = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
        token,
        data: {
          updatedAt: fixture.updatedAt,
          root: {
            id: fixture.rootGroupId,
            operator: 'and',
            sortOrder: 0,
            rules: [],
            benefits: [
              {
                benefitType: 'product_discount',
                appliesTo: 'order',
                config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: 'x' } },
              },
            ],
            children: [],
          },
        },
      });
      expect(response.status(), 'product_discount with appliesTo order should be rejected 422').toBe(422);
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
