import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupCategory,
  createCategoryFixture,
  getCategoryUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateCategoryName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CAT-category: Phase 4 record-locks coverage for the catalog CATEGORY
 * entity (`catalog.category`).
 *
 * Categories are a `makeCrudRoute` resource guarded on their OWN row by the CRUD
 * mutation-guard decorator. A stale category edit 409s; a fresh-version edit
 * succeeds. The category edit screen publishes `backend:record:current` presence
 * and now mounts the `crud-form:catalog.category` widget so the merge dialog
 * surfaces the concurrent-edit 409.
 *
 * Self-contained: creates its own category via the API, restores settings and
 * deletes the category in `finally`.
 */
test.describe('TC-LOCK-CAT-category: optimistic conflict on category edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale category edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let categoryId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['catalog.category'],
      });

      categoryId = await createCategoryFixture(request, adminToken, `QA Lock Category ${suffix}`);

      const baseUpdatedAt = await getCategoryUpdatedAt(request, adminToken, categoryId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateCategoryName(request, adminToken, categoryId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateCategoryName(request, adminToken, categoryId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getCategoryUpdatedAt(request, adminToken, categoryId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateCategoryName(request, adminToken, categoryId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupCategory(request, adminToken, categoryId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
