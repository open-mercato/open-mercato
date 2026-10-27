import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { createPromotionFixture, deletePromotionIfExists, promotionTreePath, uniqueStamp, USAGE_REGISTER_PATH } from './helpers';
import { deletePromotionUsageRowsInDb } from './helpers/db';

/**
 * TC-PROM-025 (Release 4 PLAN.md Step 6.8). SPEC-055 §Implementation Plan Phase 3 step
 * 25: a promotion with `max_budget: "500"` accepts registrations until the cumulative
 * total hits 500, then blocks with 207 + `budgetExceeded`; ADDITIONALLY "cache refresh
 * causes post-exhaustion `evaluate` to skip the promotion."
 *
 * The 207/`budgetExceeded` half is already proven end-to-end by
 * `TC-PROM-023-024-usage-register-revert-http.spec.ts`'s own budget-decrement test. This
 * spec's whole job is the part PLAN.md's Step 6.8 flags as needing re-verification rather
 * than assumption: that `services/promotion-cache.ts`'s usage-counter cache invalidation
 * (the `promotions.usage.registered` subscriber wired in Step 6.3) actually causes the
 * NEXT real `POST /api/promotions/evaluate` call to exclude the exhausted promotion —
 * exercised through the real HTTP routes for both `registerUsage` and `evaluate`, not by
 * reading `evaluation-engine.ts`'s unit test (which only proves the budget COMPARISON,
 * never the cache refresh that feeds it a fresh number).
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Implementation Plan
 * Phase 3 step 25 + §Cache Build Contract item 4/5.
 */
const EVALUATE_PATH = '/api/promotions/evaluate';

function buildCartPayload(): Record<string, unknown> {
  return {
    items: [
      {
        lineId: 'line-1',
        productId: '00000000-0000-4000-8000-000000000001',
        variantId: null,
        quantity: '1',
        unitPriceNet: '50.00',
        unitPriceGross: '61.50',
        priceIsPromotional: false,
      },
    ],
    currency: 'USD',
    evaluatedAt: new Date().toISOString(),
    buyer: { customerId: null, customerIds: [], customerGroupIds: [] },
    customerOrderCount: null,
    cartWeight: null,
    codes: [],
  };
}

test.describe('TC-PROM-025: budget cap enforcement + cache-refresh-driven evaluate skip', () => {
  test('after the budget is exhausted, cache invalidation causes the very next evaluate() to skip the promotion', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, {
        name: `QA PROM 025 ${stamp}`,
        order: 1,
        active: true,
        eligibleCurrencies: ['USD'],
        maxBudget: '300.00',
        budgetCurrency: 'USD',
      });
      promotionId = fixture.id;

      // No-rule tree (vacuous AND, matches any cart) carrying a cart_discount benefit —
      // same "always-matches" fixture shape TC-PROM-081 uses, so `evaluate` has something
      // real to include/exclude rather than a promotion with no benefits at all.
      const putTree = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
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
                appliesTo: 'order',
                config: { discountType: 'percentage', value: '5', maxDiscount: null, labels: { en: 'QA 025' } },
              },
            ],
            children: [],
          },
        },
      });
      expect(putTree.status(), 'tree PUT should succeed').toBe(200);

      // Sanity: before any usage is registered, the promotion is evaluated and matched.
      const beforeEvaluate = await apiRequest(request, 'POST', EVALUATE_PATH, { token, data: buildCartPayload() });
      expect(beforeEvaluate.status()).toBe(200);
      const beforeBody = await readJsonSafe<{ appliedPromotions: Array<{ promotionId: string }> }>(beforeEvaluate);
      expect(
        beforeBody?.appliedPromotions.some((entry) => entry.promotionId === promotionId),
        'the promotion must match before any budget is consumed',
      ).toBe(true);

      // Register usage that EXACTLY exhausts the 300.00 budget — still accepted per the
      // "accepts until the cap" rule (not yet OVER it).
      const registerResponse = await apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
        token,
        data: {
          orderId: `qa-prom-025-${stamp}`,
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions: [
            { promotionId, promotionName: 'QA Promo 025', effects: [{ type: 'LINE_DISCOUNT', amountNet: '-300.00' }] },
          ],
        },
      });
      expect(registerResponse.status(), 'exactly-at-cap registration is accepted, not blocked').toBe(200);
      expect((await readJsonSafe<{ budgetExceeded: string[] }>(registerResponse))?.budgetExceeded).toEqual([]);

      // A further registration against the now-exhausted budget is blocked (207) and
      // names this promotion — the half PLAN.md's Step 6.8 line states explicitly.
      const blockedResponse = await apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
        token,
        data: {
          orderId: `qa-prom-025-blocked-${stamp}`,
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions: [
            { promotionId, promotionName: 'QA Promo 025', effects: [{ type: 'LINE_DISCOUNT', amountNet: '-1.00' }] },
          ],
        },
      });
      expect(blockedResponse.status()).toBe(207);
      expect((await readJsonSafe<{ budgetExceeded: string[] }>(blockedResponse))?.budgetExceeded).toEqual([promotionId]);

      // The claim under test: the NEXT evaluate() call must now skip the promotion. This
      // only happens if `promotions.usage.registered`'s cache-invalidation subscriber
      // actually evicted the cached usage counter — `overlayUsageCounter` would otherwise
      // keep serving the pre-exhaustion '0' for up to `PROMOTION_USAGE_COUNTER_CACHE_TTL_MS`.
      const afterEvaluate = await apiRequest(request, 'POST', EVALUATE_PATH, { token, data: buildCartPayload() });
      expect(afterEvaluate.status()).toBe(200);
      const afterBody = await readJsonSafe<{ appliedPromotions: Array<{ promotionId: string }> }>(afterEvaluate);
      expect(
        afterBody?.appliedPromotions.some((entry) => entry.promotionId === promotionId),
        'cache refresh must cause evaluate to skip the now-exhausted promotion on the very next call',
      ).toBe(false);
    } finally {
      await deletePromotionUsageRowsInDb(promotionId);
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
