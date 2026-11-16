import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import {
  PROMOTIONS_PATH,
  USAGE_REGISTER_PATH,
  USAGE_REVERT_PATH,
  createPromotionFixture,
  deletePromotionIfExists,
  uniqueStamp,
} from './helpers';
import { readPromotionUsageRows, deletePromotionUsageRowsInDb } from './helpers/db';

/**
 * TC-PROM-023 / TC-PROM-024 (Release 4 PLAN.md Step 6.8). Both are already covered at
 * the unit level by `lib/__tests__/promotion-usage-service.test.ts` (Step 6.3) against a
 * fake `EntityManager`; this spec closes the END-TO-END gap by driving the exact same
 * assertions through the real HTTP routes (`POST /api/promotions/usage/register` and
 * `.../usage/revert`, Step 6.7) against a live Postgres row, read back directly since no
 * admin API exposes `PromotionUsage` rows (`effects_snapshot`/`total_discount_amount`/
 * `reverted_at` never reach any response body).
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §Implementation Plan
 * Phase 3 steps 23/24.
 */
test.describe('TC-PROM-023: usage/register writes the right PromotionUsage row (real HTTP)', () => {
  test('effects_snapshot carries every effect; total_discount_amount excludes ADD_FREE_ITEM', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;
    let organizationId: string | null = null;
    let tenantId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, { name: `QA PROM 023 ${stamp}` });
      promotionId = fixture.id;
      const detail = await apiRequest(request, 'GET', `${PROMOTIONS_PATH}/${promotionId}`, { token });
      const detailBody = await readJsonSafe<{ organizationId?: string; tenantId?: string }>(detail);
      organizationId = detailBody?.organizationId ?? null;
      tenantId = detailBody?.tenantId ?? null;

      const orderId = `qa-prom-023-${stamp}`;
      const appliedPromotions = [
        {
          promotionId,
          promotionName: 'QA Promo 023',
          effects: [
            { type: 'LINE_DISCOUNT', amountNet: '-7.50', amountGross: '-9.23', basis: 'net' },
            { type: 'ADD_FREE_ITEM', productId: randomUUID(), variantId: null, quantity: 1, promotionId },
          ],
        },
      ];

      const registerResponse = await apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
        token,
        data: { orderId, orderType: 'order', customerId: 'qa-customer-023', currency: 'USD', appliedPromotions },
      });
      expect(registerResponse.status(), 'usage/register should return 200 (no budget on this promotion)').toBe(200);
      const registerBody = await readJsonSafe<{ ok: boolean; budgetExceeded: string[] }>(registerResponse);
      expect(registerBody).toEqual({ ok: true, budgetExceeded: [] });

      // No API exposes `PromotionUsage` rows — read the written row directly.
      const rows = await readPromotionUsageRows({
        promotionId: promotionId!,
        organizationId: organizationId!,
        tenantId: tenantId!,
        orderId,
      });
      expect(rows, 'exactly one PromotionUsage row should have been written').toHaveLength(1);
      expect(rows[0].total_discount_amount, 'ADD_FREE_ITEM must not contribute to the amount').toBe('7.50');
      const snapshot = rows[0].effects_snapshot as Array<{ type: string }>;
      expect(snapshot).toHaveLength(2);
      expect(snapshot.map((effect) => effect.type).sort()).toEqual(['ADD_FREE_ITEM', 'LINE_DISCOUNT']);
      expect(rows[0].reverted_at).toBeNull();
    } finally {
      await deletePromotionUsageRowsInDb(promotionId);
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});

test.describe('TC-PROM-024: usage/revert sets reverted_at (never deletes); budget consumption decrements', () => {
  test('revert marks the row reverted rather than deleting it', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;
    let organizationId: string | null = null;
    let tenantId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, { name: `QA PROM 024 ${stamp}` });
      promotionId = fixture.id;
      const detail = await apiRequest(request, 'GET', `${PROMOTIONS_PATH}/${promotionId}`, { token });
      const detailBody = await readJsonSafe<{ organizationId?: string; tenantId?: string }>(detail);
      organizationId = detailBody?.organizationId ?? null;
      tenantId = detailBody?.tenantId ?? null;

      const orderId = `qa-prom-024-${stamp}`;
      const registerResponse = await apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
        token,
        data: {
          orderId,
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions: [
            { promotionId, promotionName: 'QA Promo 024', effects: [{ type: 'LINE_DISCOUNT', amountNet: '-3.00' }] },
          ],
        },
      });
      expect(registerResponse.status()).toBe(200);

      const revertResponse = await apiRequest(request, 'POST', USAGE_REVERT_PATH, { token, data: { orderId } });
      expect(revertResponse.status()).toBe(200);
      const revertBody = await readJsonSafe<{ ok: boolean; revertedCount: number }>(revertResponse);
      expect(revertBody).toEqual({ ok: true, revertedCount: 1 });

      const rows = await readPromotionUsageRows({
        promotionId: promotionId!,
        organizationId: organizationId!,
        tenantId: tenantId!,
        orderId,
      });
      expect(rows, 'the row must still exist after revert — never deleted').toHaveLength(1);
      expect(rows[0].reverted_at, 'reverted_at must be set').not.toBeNull();

      // Re-reverting is a no-op (no "every matching NON-reverted row" row left to touch).
      const secondRevert = await apiRequest(request, 'POST', USAGE_REVERT_PATH, { token, data: { orderId } });
      expect((await readJsonSafe<{ revertedCount: number }>(secondRevert))?.revertedCount).toBe(0);
    } finally {
      await deletePromotionUsageRowsInDb(promotionId);
      await deletePromotionIfExists(request, token, promotionId);
    }
  });

  test('getBudgetConsumed decrements after revert, unblocking a previously-exceeded registration', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, { name: `QA PROM 024B ${stamp}` });
      promotionId = fixture.id;
      const scopeUpdate = await apiRequest(request, 'PUT', PROMOTIONS_PATH, {
        token,
        data: { id: promotionId, maxBudget: '100.00', budgetCurrency: 'USD' },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: fixture.updatedAt },
      });
      expect(scopeUpdate.status()).toBe(200);

      const orderA = `qa-prom-024b-a-${stamp}`;
      const orderB = `qa-prom-024b-b-${stamp}`;

      // Fills the budget exactly — accepted (TC-PROM-025's own "accepts until it hits
      // the cap" boundary).
      const registerA = await apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
        token,
        data: {
          orderId: orderA,
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions: [{ promotionId, promotionName: 'Promo', effects: [{ type: 'LINE_DISCOUNT', amountNet: '-100.00' }] }],
        },
      });
      expect(registerA.status()).toBe(200);

      // Budget is now fully consumed — any further registration is blocked (207).
      const registerBBlocked = await apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
        token,
        data: {
          orderId: orderB,
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions: [{ promotionId, promotionName: 'Promo', effects: [{ type: 'LINE_DISCOUNT', amountNet: '-1.00' }] }],
        },
      });
      expect(registerBBlocked.status(), 'budget is exhausted — this registration must be blocked').toBe(207);
      expect((await readJsonSafe<{ budgetExceeded: string[] }>(registerBBlocked))?.budgetExceeded).toEqual([promotionId]);
      // The blocked attempt never wrote a row for orderB (idempotency key is free).

      // Revert order A — this must decrement the authoritative `getBudgetConsumed` sum
      // back to 0 (not just flip a flag), which is only observable through the NEXT
      // registration's own outcome (no admin route reads `getBudgetConsumed` directly).
      const revertA = await apiRequest(request, 'POST', USAGE_REVERT_PATH, { token, data: { orderId: orderA } });
      expect(revertA.status()).toBe(200);

      const registerBAfterRevert = await apiRequest(request, 'POST', USAGE_REGISTER_PATH, {
        token,
        data: {
          orderId: orderB,
          orderType: 'order',
          customerId: null,
          currency: 'USD',
          appliedPromotions: [{ promotionId, promotionName: 'Promo', effects: [{ type: 'LINE_DISCOUNT', amountNet: '-1.00' }] }],
        },
      });
      expect(registerBAfterRevert.status(), 'budget was freed by the revert — this must now succeed').toBe(200);
      expect((await readJsonSafe<{ budgetExceeded: string[] }>(registerBAfterRevert))?.budgetExceeded).toEqual([]);
    } finally {
      await deletePromotionUsageRowsInDb(promotionId);
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
