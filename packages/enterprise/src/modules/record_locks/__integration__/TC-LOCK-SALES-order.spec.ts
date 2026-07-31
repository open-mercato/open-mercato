import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupOrder,
  createOrderFixture,
  createOrderLineFixtureForLock,
  getOrderUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateOrderComment,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-SALES-order: Phase 3 record-locks coverage for the sales ORDER
 * document aggregate (`sales.order`).
 *
 * Orders are command-pattern documents. Header edits + every sub-resource write
 * guard the parent order's `updated_at` (the consistency boundary) via
 * `enforceSalesDocumentOptimisticLock` → the async record_locks seam. A
 * concurrent edit that recalculates the order (e.g. adding a line) advances the
 * aggregate version, so a stale order edit must 409 and route to the merge
 * dialog / conflict bar; a fresh-version edit succeeds.
 *
 * Self-contained: creates its own order via the API, restores settings and
 * deletes the order in `finally`.
 */
test.describe('TC-LOCK-SALES-order: optimistic conflict on order aggregate edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale order edit 409s after a concurrent sub-resource write; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let orderId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['sales.order'],
      });

      const suffix = `${Date.now()}`;
      orderId = await createOrderFixture(request, adminToken, 'USD');

      const baseUpdatedAt = await getOrderUpdatedAt(request, adminToken, orderId);
      expect(baseUpdatedAt).toBeTruthy();

      // Concurrent edit: adding a line recalculates totals and advances the
      // order aggregate's `updated_at` out from under the stale base version.
      // Under full-suite timing the first advance can land on the same timestamp,
      // so re-read and force a distinct second advance until the version moves —
      // making the stale-edit 409 deterministic, not timing-dependent.
      let latestUpdatedAt = baseUpdatedAt;
      await createOrderLineFixtureForLock(request, adminToken, orderId, latestUpdatedAt);
      latestUpdatedAt = await getOrderUpdatedAt(request, adminToken, orderId);
      expect(latestUpdatedAt).toBeTruthy();
      while (latestUpdatedAt === baseUpdatedAt) {
        await createOrderLineFixtureForLock(request, adminToken, orderId, latestUpdatedAt);
        latestUpdatedAt = await getOrderUpdatedAt(request, adminToken, orderId);
        expect(latestUpdatedAt).toBeTruthy();
      }
      expect(latestUpdatedAt, "adding a line should advance the parent order's updated_at").not.toBe(baseUpdatedAt);

      // Stale order header edit → 409 (document-aggregate guard fires).
      const stale = await updateOrderComment(request, adminToken, orderId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getOrderUpdatedAt(request, adminToken, orderId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateOrderComment(request, adminToken, orderId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupOrder(request, adminToken, orderId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
