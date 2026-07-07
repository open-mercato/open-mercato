import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupProduct,
  createProductFixture,
  getProductUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateProductTitle,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CAT-product: Phase 4 record-locks coverage for the catalog PRODUCT
 * entity (`catalog.product`).
 *
 * Products are a `makeCrudRoute` resource guarded on their OWN row by the CRUD
 * mutation-guard decorator (the enterprise `crudMutationGuardService` override is
 * global). A stale product edit 409s; a fresh-version edit succeeds. The product
 * detail screen publishes `backend:record:current` presence so the merge dialog
 * surfaces the concurrent-edit 409.
 *
 * Self-contained: creates its own product via the API, restores settings and
 * deletes the product in `finally`.
 */
test.describe('TC-LOCK-CAT-product: optimistic conflict on product edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale product edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let productId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['catalog.product'],
      });

      productId = await createProductFixture(request, adminToken, `QA Lock Product ${suffix}`);

      const baseUpdatedAt = await getProductUpdatedAt(request, adminToken, productId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateProductTitle(request, adminToken, productId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateProductTitle(request, adminToken, productId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getProductUpdatedAt(request, adminToken, productId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateProductTitle(request, adminToken, productId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupProduct(request, adminToken, productId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
