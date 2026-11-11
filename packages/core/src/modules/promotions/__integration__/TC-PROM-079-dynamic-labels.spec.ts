import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPromotionFixture, deletePromotionIfExists, promotionTreePath, uniqueStamp } from './helpers';

/**
 * TC-PROM-079: `GET /api/promotions/dynamic-labels` returns a non-empty list
 * of simplified promotion condition summaries after creating a real
 * promotion fixture.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Cart-Facing
 * Endpoints `GET /api/promotions/dynamic-labels` + §Implementation Plan
 * Phase 2 step 7.
 */
const DYNAMIC_LABELS_PATH = '/api/promotions/dynamic-labels';

test.describe('TC-PROM-079: GET /api/promotions/dynamic-labels', () => {
  test('returns a non-empty list after creating a real promotion fixture', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, {
        name: `QA PROM 079 ${stamp}`,
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

      const response = await apiRequest(request, 'GET', DYNAMIC_LABELS_PATH, { token });
      expect(response.status(), 'dynamic-labels should return 200').toBe(200);
      const body = await readJsonSafe<{
        promotions: Array<{ promotionId: string; promotionName: string; tags: string[]; conditions: Array<Record<string, unknown>> }>;
      }>(response);

      expect(body?.promotions.length ?? 0, 'dynamic-labels should return a non-empty list').toBeGreaterThan(0);
      const match = body?.promotions.find((entry) => entry.promotionId === promotionId);
      expect(match, 'the fixture promotion should be present in the response').toBeTruthy();
      expect(match?.conditions).toHaveLength(1);
      expect(match?.conditions[0]).toMatchObject({ type: 'order_value' });
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
