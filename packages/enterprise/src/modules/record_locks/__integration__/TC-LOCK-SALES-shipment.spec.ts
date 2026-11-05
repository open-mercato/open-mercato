import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupOrder,
  createOrderFixture,
  createOrderLineFixtureForLock,
  createShipmentFixture,
  getOrderUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateShipmentCarrier,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-SALES-shipment: Phase 3 record-locks coverage for sales SHIPMENTS
 * (Gap B) — shipments guard the PARENT ORDER's aggregate version.
 *
 * A shipment mutation guards the PARENT ORDER's aggregate version, so the order
 * is the consistency boundary. Phase 3 wraps shipment create/update/delete with
 * `enforceSalesDocumentOptimisticLock(ctx, order, 'sales.order')` and redirects
 * the CRUD-layer guard's reader to the parent order, so the single optimistic-lock
 * header always carries the ORDER version. A shipment write carrying a stale order
 * version (after a concurrent write advanced it) 409s.
 *
 * Note: shipment-create does NOT bump the order's `updated_at`, so the order
 * version is advanced OUT-OF-BAND with a second line (mirroring TC-LOCK-OSS-026's
 * shipment case) to make `baseUpdatedAt` genuinely stale before the stale PUT.
 *
 * Self-contained: creates its own order + line, restores settings and deletes
 * the order (cascading shipments) in `finally`.
 */
test.describe('TC-LOCK-SALES-shipment: optimistic conflict on shipment vs parent order', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a shipment write with a stale parent-order version 409s; a fresh-version write succeeds', async ({ request }) => {
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
      let currentUpdatedAt = await getOrderUpdatedAt(request, adminToken, orderId);
      expect(currentUpdatedAt).toBeTruthy();

      const orderLineId = await createOrderLineFixtureForLock(request, adminToken, orderId, currentUpdatedAt);

      // Re-read: the line write advanced the order aggregate version.
      currentUpdatedAt = await getOrderUpdatedAt(request, adminToken, orderId);
      expect(currentUpdatedAt).toBeTruthy();

      // Create the shipment with the current order version. Shipment-create does
      // NOT bump the order's `updated_at`, so this version is not yet stale.
      const shipmentId = await createShipmentFixture(request, adminToken, orderId, orderLineId, currentUpdatedAt);

      // t0: the order version captured by the editor (after the shipment exists).
      const baseUpdatedAt = await getOrderUpdatedAt(request, adminToken, orderId);
      expect(baseUpdatedAt).toBeTruthy();

      // Advance the ORDER out-of-band with a SECOND line → totals recalc dirties
      // the order → its aggregate version moves away from `baseUpdatedAt`.
      await createOrderLineFixtureForLock(request, adminToken, orderId, baseUpdatedAt);
      const advancedUpdatedAt = await getOrderUpdatedAt(request, adminToken, orderId);
      expect(advancedUpdatedAt, "adding a line should advance the parent order's updated_at").not.toBe(baseUpdatedAt);

      // A shipment write carrying the now-stale order version → 409.
      const stale = await updateShipmentCarrier(request, adminToken, shipmentId, orderId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getOrderUpdatedAt(request, adminToken, orderId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateShipmentCarrier(request, adminToken, shipmentId, orderId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupOrder(request, adminToken, orderId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
