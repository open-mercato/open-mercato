import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupProduct,
  cleanupVariant,
  createProductFixture,
  createVariantFixture,
  getRecordLockSettings,
  getVariantUpdatedAt,
  saveRecordLockSettings,
  updateVariantName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CAT-variant: Phase 4 record-locks coverage for the catalog VARIANT
 * entity (`catalog.variant`).
 *
 * Variants are a `makeCrudRoute` resource guarded on their OWN row by the CRUD
 * mutation-guard decorator. A stale variant edit 409s; a fresh-version edit
 * succeeds. The variant edit screen publishes `backend:record:current` presence
 * and now mounts the `crud-form:catalog.variant` widget so the merge dialog
 * surfaces the concurrent-edit 409.
 *
 * Self-contained: creates its own product + variant via the API, restores
 * settings and deletes both in `finally`.
 */
test.describe('TC-LOCK-CAT-variant: optimistic conflict on variant edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale variant edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let productId: string | null = null;
    let variantId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['catalog.variant'],
      });

      productId = await createProductFixture(request, adminToken, `QA Lock Variant Product ${suffix}`);
      variantId = await createVariantFixture(request, adminToken, productId, `QA Lock Variant ${suffix}`);

      const baseUpdatedAt = await getVariantUpdatedAt(request, adminToken, variantId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateVariantName(request, adminToken, variantId, productId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateVariantName(request, adminToken, variantId, productId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getVariantUpdatedAt(request, adminToken, variantId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateVariantName(request, adminToken, variantId, productId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupVariant(request, adminToken, variantId);
      await cleanupProduct(request, adminToken, productId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
