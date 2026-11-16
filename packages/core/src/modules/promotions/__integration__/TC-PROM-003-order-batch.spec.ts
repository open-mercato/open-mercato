import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import {
  PROMOTIONS_ORDER_PATH,
  PROMOTIONS_PATH,
  createPromotionFixture,
  deletePromotionIfExists,
  getPromotionDetail,
  uniqueStamp,
} from './helpers';

/**
 * TC-PROM-003: `PATCH /api/promotions/order` batch-updates display order; a
 * stale `updatedAt` on one item 409s only that item (`{ updated, conflicts
 * }`), while sibling items in the same batch still apply.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §API Contracts
 * `PATCH /api/promotions/order` + §Implementation Plan Phase 1 step 17.
 */
test.describe('TC-PROM-003: order batch update', () => {
  test('a mixed batch applies fresh items and reports the stale one as a conflict', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionAId: string | null = null;
    let promotionBId: string | null = null;

    try {
      const fixtureA = await createPromotionFixture(request, token, { name: `QA PROM 003 A ${stamp}`, order: 1 });
      const fixtureB = await createPromotionFixture(request, token, { name: `QA PROM 003 B ${stamp}`, order: 2 });
      promotionAId = fixtureA.id;
      promotionBId = fixtureB.id;

      // Advance B's updatedAt out from under the batch, so its captured
      // fixture.updatedAt becomes genuinely stale by the time the batch runs.
      const bBump = await apiRequest(request, 'PUT', PROMOTIONS_PATH, {
        token,
        data: { id: promotionBId, name: `QA PROM 003 B Renamed ${stamp}` },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: fixtureB.updatedAt },
      });
      expect(bBump.status()).toBe(200);
      const bAfterBump = await getPromotionDetail(request, token, promotionBId);
      const freshBUpdatedAt = bAfterBump.updatedAt;
      expect(freshBUpdatedAt).not.toBe(fixtureB.updatedAt);

      const batchResponse = await apiRequest(request, 'PATCH', PROMOTIONS_ORDER_PATH, {
        token,
        data: {
          items: [
            { id: promotionAId, order: 10, updatedAt: fixtureA.updatedAt },
            { id: promotionBId, order: 20, updatedAt: fixtureB.updatedAt }, // stale
          ],
        },
      });
      expect(batchResponse.status(), 'order batch PATCH should return 200 even with a per-item conflict').toBe(200);
      const batchBody = await readJsonSafe<{ updated?: string[]; conflicts?: Array<{ id: string; currentUpdatedAt: string }> }>(
        batchResponse,
      );

      expect(batchBody?.updated ?? []).toEqual([promotionAId]);
      expect(batchBody?.conflicts ?? []).toHaveLength(1);
      expect(batchBody?.conflicts?.[0]).toMatchObject({ id: promotionBId, currentUpdatedAt: freshBUpdatedAt });

      // A's order applied; B's order is untouched by the rejected item.
      const detailA = await getPromotionDetail(request, token, promotionAId);
      expect(detailA.order).toBe(10);
      const detailB = await getPromotionDetail(request, token, promotionBId);
      expect(detailB.order).toBe(2);
    } finally {
      await deletePromotionIfExists(request, token, promotionAId);
      await deletePromotionIfExists(request, token, promotionBId);
    }
  });
});
