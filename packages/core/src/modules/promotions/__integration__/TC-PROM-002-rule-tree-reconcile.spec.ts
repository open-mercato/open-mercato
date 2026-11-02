import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import { createPromotionFixture, deletePromotionIfExists, getPromotionDetail, promotionTreePath, uniqueStamp } from './helpers';

/**
 * TC-PROM-002: `PUT /api/promotions/[id]/tree` reconciles the whole rule
 * group tree in one call (add groups/rules/benefits, update one, remove
 * one), and 409s on a stale promotion `updatedAt`.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §API Contracts
 * `PUT /api/promotions/[id]/tree` + §Implementation Plan Phase 1 step 17.
 */
test.describe('TC-PROM-002: rule tree reconcile', () => {
  test('adds, updates, and removes groups/rules/benefits; 409s on a stale updatedAt', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      // D-R4-27: a promotion whose tree carries an `order_value`/`row_total` rule (a
      // monetary threshold) must set exactly one `eligibleCurrencies` entry — this tree
      // uses `order_value`, so the fixture declares its currency up front.
      const fixture = await createPromotionFixture(request, token, {
        name: `QA PROM 002 ${stamp}`,
        order: 1,
        eligibleCurrencies: ['USD'],
      });
      promotionId = fixture.id;
      const t0 = fixture.updatedAt;
      const rootGroupId = fixture.rootGroupId;

      // First reconcile: one rule + one benefit on the root group.
      const firstPut = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
        token,
        data: {
          updatedAt: t0,
          root: {
            id: rootGroupId,
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
      expect(firstPut.status(), 'first tree reconcile should succeed').toBe(200);

      const afterFirst = await getPromotionDetail(request, token, promotionId);
      const t1 = afterFirst.updatedAt;
      expect(t1).not.toBe(t0);
      expect(afterFirst.ruleGroupTree?.rules).toHaveLength(1);
      expect(afterFirst.ruleGroupTree?.rules[0]).toMatchObject({ ruleType: 'order_value' });
      expect(afterFirst.ruleGroupTree?.rules[0].config).toMatchObject({ value: '10.00', operator: 'gte' });
      expect(afterFirst.ruleGroupTree?.benefits).toHaveLength(1);
      expect(afterFirst.ruleGroupTree?.benefits[0]).toMatchObject({ benefitType: 'cart_discount', appliesTo: 'order' });
      const existingRuleId = afterFirst.ruleGroupTree!.rules[0].id;

      // Second reconcile: update the existing rule's value, replace the
      // cart_discount benefit with a free_product one (removal), and add a
      // nested child rule group (addition).
      const secondPut = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
        token,
        data: {
          updatedAt: t1,
          root: {
            id: rootGroupId,
            operator: 'and',
            sortOrder: 0,
            rules: [
              {
                id: existingRuleId,
                ruleType: 'order_value',
                config: { value: '20.00', operator: 'gte', taxInclusive: false, limitToCategory: null },
              },
            ],
            benefits: [
              {
                benefitType: 'free_product',
                appliesTo: 'order',
                config: { productId: null, categoryId: null, quantity: 1, labels: { en: 'Free item' } },
              },
            ],
            children: [
              {
                operator: 'or',
                sortOrder: 0,
                rules: [{ ruleType: 'product_count', config: { value: 2, operator: 'gte' } }],
                benefits: [],
                children: [],
              },
            ],
          },
        },
      });
      expect(secondPut.status(), 'second tree reconcile should succeed').toBe(200);

      const afterSecond = await getPromotionDetail(request, token, promotionId);
      const t2 = afterSecond.updatedAt;
      expect(t2).not.toBe(t1);

      // The updated rule kept its id and new value.
      expect(afterSecond.ruleGroupTree?.rules).toHaveLength(1);
      expect(afterSecond.ruleGroupTree?.rules[0].id).toBe(existingRuleId);
      expect(afterSecond.ruleGroupTree?.rules[0].config).toMatchObject({ value: '20.00' });

      // The cart_discount benefit was removed; free_product is the only one left.
      expect(afterSecond.ruleGroupTree?.benefits).toHaveLength(1);
      expect(afterSecond.ruleGroupTree?.benefits[0]).toMatchObject({ benefitType: 'free_product', appliesTo: 'order' });

      // The new child group landed with its own rule.
      expect(afterSecond.ruleGroupTree?.children).toHaveLength(1);
      const child = afterSecond.ruleGroupTree!.children[0];
      expect(child.operator).toBe('or');
      expect(child.rules).toHaveLength(1);
      expect(child.rules[0]).toMatchObject({ ruleType: 'product_count' });

      // Stale optimistic lock: reusing t1 (now superseded by t2) 409s.
      const stalePut = await apiRequest(request, 'PUT', promotionTreePath(promotionId), {
        token,
        data: {
          updatedAt: t1,
          root: { id: rootGroupId, operator: 'and', sortOrder: 0, rules: [], benefits: [], children: [] },
        },
      });
      expect(stalePut.status(), 'stale tree reconcile should 409').toBe(409);
      const staleBody = await readJsonSafe<Record<string, unknown>>(stalePut);
      expect(staleBody).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: t1,
        currentUpdatedAt: t2,
      });

      // The rejected stale write never applied — tree survives from the second reconcile.
      const survivor = await getPromotionDetail(request, token, promotionId);
      expect(survivor.ruleGroupTree?.rules).toHaveLength(1);
      expect(survivor.ruleGroupTree?.children).toHaveLength(1);
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
