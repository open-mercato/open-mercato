import { expect, test } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers';
import {
  PROMOTIONS_PATH,
  createPromotionFixture,
  deletePromotionIfExists,
  getPromotionDetail,
  promotionDetailPath,
  uniqueStamp,
} from './helpers';

/**
 * TC-PROM-001: Promotion CRUD round-trip (create / read / update / soft
 * delete) via `/api/promotions` and `/api/promotions/[id]`, including
 * optimistic-lock enforcement on update and delete.
 * Source: .ai/specs/SPEC-055-2026-02-23-promotions-module.md §API Contracts
 * "Admin CRUD" + §Implementation Plan Phase 1 step 17.
 */
test.describe('TC-PROM-001: promotion CRUD round-trip', () => {
  test('create, read, update, and soft-delete a promotion with optimistic-lock enforcement', async ({ request }) => {
    const token = await getAuthToken(request, 'admin');
    const stamp = uniqueStamp();
    let promotionId: string | null = null;

    try {
      const fixture = await createPromotionFixture(request, token, {
        name: `QA PROM 001 ${stamp}`,
        order: 7,
        active: false,
        cumulative: true,
      });
      promotionId = fixture.id;
      const t0 = fixture.updatedAt;
      expect(t0).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // GET detail: metadata persisted, root rule group auto-created, empty.
      const detail = await getPromotionDetail(request, token, promotionId);
      expect(detail.name).toBe(`QA PROM 001 ${stamp}`);
      expect(detail.order).toBe(7);
      expect(detail.active).toBe(false);
      expect(detail.ruleGroupTree).not.toBeNull();
      expect(detail.ruleGroupTree?.rules ?? []).toHaveLength(0);
      expect(detail.ruleGroupTree?.benefits ?? []).toHaveLength(0);

      // GET list: the promotion appears and carries updatedAt (CrudForm's
      // optimistic-lock auto-derive source).
      const listResponse = await apiRequest(request, 'GET', `${PROMOTIONS_PATH}?pageSize=100`, { token });
      expect(listResponse.status()).toBe(200);
      const listBody = await readJsonSafe<{ items?: Array<{ id: string; updatedAt?: string | null }> }>(listResponse);
      const listed = (listBody?.items ?? []).find((item) => item.id === promotionId);
      expect(listed, 'created promotion should appear in the list').toBeTruthy();
      expect(typeof listed?.updatedAt).toBe('string');

      // Session A: fresh t0 lock token, wins.
      const sessionAResponse = await apiRequest(request, 'PUT', PROMOTIONS_PATH, {
        token,
        data: { id: promotionId, name: `QA PROM 001 Updated ${stamp}` },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: t0 },
      });
      expect(sessionAResponse.status(), 'session A (fresh t0) PUT should win').toBe(200);

      const afterUpdate = await getPromotionDetail(request, token, promotionId);
      const t1 = afterUpdate.updatedAt;
      expect(afterUpdate.name).toBe(`QA PROM 001 Updated ${stamp}`);
      expect(t1, 'updatedAt must advance after the update').not.toBe(t0);

      // Session B: stale t0 lock token, refused with the structured 409.
      const sessionBResponse = await apiRequest(request, 'PUT', PROMOTIONS_PATH, {
        token,
        data: { id: promotionId, name: `QA PROM 001 Stale Write ${stamp}` },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: t0 },
      });
      expect(sessionBResponse.status(), 'stale session B PUT should be refused with 409').toBe(409);
      const sessionBBody = await readJsonSafe<Record<string, unknown>>(sessionBResponse);
      expect(sessionBBody).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        expectedUpdatedAt: t0,
      });
      expect(sessionBBody?.currentUpdatedAt).toBe(t1);

      // The rejected session B write never applied.
      const survivor = await getPromotionDetail(request, token, promotionId);
      expect(survivor.name).toBe(`QA PROM 001 Updated ${stamp}`);

      // Stale DELETE: same conflict shape.
      const staleDeleteResponse = await apiRequest(
        request,
        'DELETE',
        `${PROMOTIONS_PATH}?id=${encodeURIComponent(promotionId)}`,
        { token, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: t0 } },
      );
      expect(staleDeleteResponse.status(), 'stale DELETE should be refused with 409').toBe(409);
      const staleDeleteBody = await readJsonSafe<Record<string, unknown>>(staleDeleteResponse);
      expect(staleDeleteBody).toMatchObject({
        error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      });

      // Fresh DELETE: soft-deletes the promotion.
      const freshDeleteResponse = await apiRequest(
        request,
        'DELETE',
        `${PROMOTIONS_PATH}?id=${encodeURIComponent(promotionId)}`,
        { token, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: t1 } },
      );
      expect(freshDeleteResponse.status(), 'fresh DELETE should succeed').toBe(200);

      const afterDelete = await apiRequest(request, 'GET', promotionDetailPath(promotionId), { token });
      expect(afterDelete.status(), 'soft-deleted promotion should 404 on detail GET').toBe(404);
    } finally {
      await deletePromotionIfExists(request, token, promotionId);
    }
  });
});
