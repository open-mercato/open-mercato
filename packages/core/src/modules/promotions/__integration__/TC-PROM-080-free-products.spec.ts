import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPromotionFixture, deletePromotionIfExists, promotionTreePath, uniqueStamp } from './helpers';

/**
 * TC-PROM-080: `POST /api/promotions/free-products` returns only
 * `ADD_FREE_ITEM`-shaped offers for a `free_product` benefit fixture, and
 * filters out a co-existing `cart_discount` promotion's effects entirely
 * from the response.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Cart-Facing
 * Endpoints `POST /api/promotions/free-products` + §Implementation Plan
 * Phase 2 step 7.
 */
const FREE_PRODUCTS_PATH = '/api/promotions/free-products';

test.describe('TC-PROM-080: POST /api/promotions/free-products', () => {
  test('returns only ADD_FREE_ITEM offers, filtering out a co-existing cart_discount promotion', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let freeProductPromotionId: string | null = null;
    let cartDiscountPromotionId: string | null = null;
    const rewardProductId = randomUUID();

    try {
      const freeFixture = await createPromotionFixture(request, token, {
        name: `QA PROM 080 Free ${stamp}`,
        order: 1,
        active: true,
        // D-R4-27: the `order_value` rule below is a currency-sensitive rule type —
        // it requires exactly one `eligibleCurrencies` entry even though the
        // `free_product` benefit itself has no monetary amount.
        eligibleCurrencies: ['USD'],
      });
      freeProductPromotionId = freeFixture.id;
      const freePut = await apiRequest(request, 'PUT', promotionTreePath(freeProductPromotionId), {
        token,
        data: {
          updatedAt: freeFixture.updatedAt,
          root: {
            id: freeFixture.rootGroupId,
            operator: 'and',
            sortOrder: 0,
            rules: [
              {
                ruleType: 'order_value',
                config: { value: '1.00', operator: 'gte', taxInclusive: false, limitToCategory: null },
              },
            ],
            benefits: [
              {
                benefitType: 'free_product',
                appliesTo: 'order',
                config: { productId: rewardProductId, categoryId: null, quantity: 1, labels: { en: 'Free gift' } },
              },
            ],
            children: [],
          },
        },
      });
      expect(freePut.status(), 'free_product tree PUT should succeed').toBe(200);

      const discountFixture = await createPromotionFixture(request, token, {
        name: `QA PROM 080 Discount ${stamp}`,
        order: 2,
        active: true,
        eligibleCurrencies: ['USD'],
      });
      cartDiscountPromotionId = discountFixture.id;
      const discountPut = await apiRequest(request, 'PUT', promotionTreePath(cartDiscountPromotionId), {
        token,
        data: {
          updatedAt: discountFixture.updatedAt,
          root: {
            id: discountFixture.rootGroupId,
            operator: 'and',
            sortOrder: 0,
            rules: [
              {
                ruleType: 'order_value',
                config: { value: '1.00', operator: 'gte', taxInclusive: false, limitToCategory: null },
              },
            ],
            benefits: [
              {
                benefitType: 'cart_discount',
                appliesTo: 'order',
                config: { discountType: 'percentage', value: '10', maxDiscount: null, labels: { en: '10% off' } },
              },
            ],
            children: [],
          },
        },
      });
      expect(discountPut.status(), 'cart_discount tree PUT should succeed').toBe(200);

      const response = await apiRequest(request, 'POST', FREE_PRODUCTS_PATH, {
        token,
        data: {
          items: [
            {
              lineId: randomUUID(),
              productId: randomUUID(),
              variantId: null,
              quantity: '1',
              unitPriceNet: '20.00',
              unitPriceGross: '24.60',
              priceIsPromotional: false,
            },
          ],
          currency: 'USD',
          evaluatedAt: new Date().toISOString(),
          buyer: { customerId: null, customerIds: [], customerGroupIds: [] },
          customerOrderCount: null,
          cartWeight: null,
          codes: [],
        },
      });
      expect(response.status(), 'free-products should return 200').toBe(200);
      const body = await readJsonSafe<{
        appliedPromotions: Array<{ promotionId: string; promotionName: string; effects: Array<Record<string, unknown>> }>;
      }>(response);

      const freeEntry = body?.appliedPromotions.find((entry) => entry.promotionId === freeProductPromotionId);
      expect(freeEntry, 'the free_product promotion should be present').toBeTruthy();
      expect(freeEntry?.effects).toHaveLength(1);
      expect(freeEntry?.effects[0]).toMatchObject({ type: 'ADD_FREE_ITEM', productId: rewardProductId, reason: 'FREE_PRODUCT' });

      const discountEntry = body?.appliedPromotions.find((entry) => entry.promotionId === cartDiscountPromotionId);
      expect(discountEntry, 'a cart_discount-only promotion must not appear in a free-products response').toBeUndefined();

      for (const applied of body?.appliedPromotions ?? []) {
        for (const effect of applied.effects) {
          expect(effect.type).toBe('ADD_FREE_ITEM');
        }
      }
    } finally {
      await deletePromotionIfExists(request, token, freeProductPromotionId);
      await deletePromotionIfExists(request, token, cartDiscountPromotionId);
    }
  });
});
