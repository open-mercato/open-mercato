import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupPriceKind,
  createPriceKindFixture,
  getPriceKindUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updatePriceKindTitle,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CAT-price-kind: Phase 4 record-locks coverage for the catalog
 * PRICE-KIND entity (`catalog.price.kind`).
 *
 * Price kinds are a `makeCrudRoute` resource (a list/dialog editor, no detail-
 * screen presence) guarded on their OWN row by the CRUD mutation-guard decorator.
 * The custom `PriceKindSettings` dialog sends the OSS optimistic-lock header on
 * PUT/DELETE and routes a 409 through the single conflict surface. A stale price-
 * kind edit 409s; a fresh-version edit succeeds.
 *
 * Self-contained: creates its own price kind via the API, restores settings and
 * deletes the price kind in `finally`.
 */
test.describe('TC-LOCK-CAT-price-kind: optimistic conflict on price-kind edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale price-kind edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let priceKindId: string | null = null;
    const suffix = `${Date.now()}`;
    const code = `qa_lock_pk_${suffix}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['catalog.price.kind'],
      });

      priceKindId = await createPriceKindFixture(request, adminToken, { code, title: `QA Lock Price Kind ${suffix}` });

      const baseUpdatedAt = await getPriceKindUpdatedAt(request, adminToken, priceKindId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updatePriceKindTitle(request, adminToken, priceKindId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updatePriceKindTitle(request, adminToken, priceKindId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getPriceKindUpdatedAt(request, adminToken, priceKindId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updatePriceKindTitle(request, adminToken, priceKindId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupPriceKind(request, adminToken, priceKindId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
