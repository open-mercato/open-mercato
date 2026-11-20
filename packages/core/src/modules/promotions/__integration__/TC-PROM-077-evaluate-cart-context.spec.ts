import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPromotionFixture, deletePromotionIfExists, promotionTreePath, uniqueStamp } from './helpers';

/**
 * TC-PROM-077: `POST /api/promotions/evaluate` resolves a real `order_value` +
 * `cart_discount` promotion against a cart context and returns its resolved
 * effect; a malformed body 400s; a caller missing `promotions.evaluate` 403s.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Cart-Facing
 * Endpoints `POST /api/promotions/evaluate` + §Implementation Plan Phase 2
 * step 7.
 */
const EVALUATE_PATH = '/api/promotions/evaluate';

test.describe('TC-PROM-077: POST /api/promotions/evaluate', () => {
  test('matches a real order_value + cart_discount promotion and returns its resolved effect', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, {
        name: `QA PROM 077 ${stamp}`,
        order: 1,
        active: true,
        eligibleCurrencies: ['USD'],
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
            rules: [
              {
                ruleType: 'order_value',
                config: { value: '10.00', operator: 'gte', taxInclusive: false, limitToCategory: null },
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
      expect(putTree.status(), 'tree PUT should succeed').toBe(200);

      const evaluateResponse = await apiRequest(request, 'POST', EVALUATE_PATH, {
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
      expect(evaluateResponse.status(), 'evaluate should return 200').toBe(200);
      const body = await readJsonSafe<{
        appliedPromotions: Array<{ promotionId: string; promotionName: string; effects: Array<Record<string, unknown>> }>;
      }>(evaluateResponse);
      const applied = body?.appliedPromotions.find((entry) => entry.promotionId === promotionId);
      expect(applied, 'the fixture promotion should be among appliedPromotions').toBeTruthy();
      expect(applied?.effects).toHaveLength(1);
      expect(applied?.effects[0]).toMatchObject({ type: 'CART_DISCOUNT', amountNet: '-2.00', currency: 'USD' });
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
    }
  });

  test('400s on a malformed body', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const response = await apiRequest(request, 'POST', EVALUATE_PATH, {
      token,
      data: { items: 'not-an-array' },
    });
    expect(response.status(), 'malformed evaluate body should 400').toBe(400);
    const body = await readJsonSafe<Record<string, unknown>>(response);
    expect(Array.isArray(body?.issues)).toBe(true);
  });

  test('403s without the promotions.evaluate feature', async ({ request }) => {
    const employeeToken = await getAuthToken(request, 'employee');
    const response = await apiRequest(request, 'POST', EVALUATE_PATH, { token: employeeToken, data: {} });
    expect(response.status(), 'employee should be forbidden without promotions.evaluate').toBe(403);
  });
});
