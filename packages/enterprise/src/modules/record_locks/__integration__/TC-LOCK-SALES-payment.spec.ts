import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupOrder,
  createOrderFixture,
  createPaymentFixture,
  getOrderUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updatePaymentReference,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-SALES-payment: Phase 3 record-locks coverage for sales PAYMENTS
 * (Gap A) — payments guard the PARENT ORDER's aggregate version.
 *
 * A payment mutation recalculates the order totals, so the order is the
 * consistency boundary. Phase 3 wraps payment create/update/delete with
 * `enforceSalesDocumentOptimisticLock(ctx, order, 'sales.order')` and redirects
 * the CRUD-layer guard's reader to the parent order, so the single
 * optimistic-lock header always carries the ORDER version. A second payment
 * write carrying a stale order version (after the first advanced it) 409s.
 *
 * Self-contained: creates its own order, restores settings and deletes the
 * order (cascading payments) in `finally`.
 */
test.describe('TC-LOCK-SALES-payment: optimistic conflict on payment vs parent order', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a payment write with a stale parent-order version 409s; a fresh-version write succeeds', async ({ request }) => {
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

      // Creating a payment recalculates order totals → advances the order
      // aggregate version away from `baseUpdatedAt`.
      const paymentId = await createPaymentFixture(request, adminToken, orderId, baseUpdatedAt);

      // A second payment write carrying the now-stale order version → 409.
      const stale = await updatePaymentReference(request, adminToken, paymentId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getOrderUpdatedAt(request, adminToken, orderId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updatePaymentReference(request, adminToken, paymentId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupOrder(request, adminToken, orderId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
