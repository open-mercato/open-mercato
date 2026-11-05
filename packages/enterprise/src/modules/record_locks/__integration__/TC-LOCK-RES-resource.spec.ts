import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupResource,
  createResourceFixture,
  getRecordLockSettings,
  getResourceUpdatedAt,
  saveRecordLockSettings,
  updateResourceName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-RES-resource: Phase 5 record-locks coverage for the resources RESOURCE
 * entity (`resources.resource`).
 *
 * Resources are a `makeCrudRoute` resource guarded on their OWN row by the CRUD
 * mutation-guard decorator. A stale resource edit 409s; a fresh-version edit
 * succeeds. The resource detail screen publishes `backend:record:current`
 * presence so the merge dialog surfaces the concurrent-edit 409. Tag
 * assign/unassign are junctions and are intentionally not exercised here.
 *
 * Self-contained: creates its own resource via the API, restores settings and
 * deletes the resource in `finally`.
 */
test.describe('TC-LOCK-RES-resource: optimistic conflict on resource edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale resource edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let resourceId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['resources.resource'],
      });

      resourceId = await createResourceFixture(request, adminToken, `QA Lock Resource ${suffix}`);

      const baseUpdatedAt = await getResourceUpdatedAt(request, adminToken, resourceId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateResourceName(request, adminToken, resourceId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateResourceName(request, adminToken, resourceId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getResourceUpdatedAt(request, adminToken, resourceId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateResourceName(request, adminToken, resourceId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupResource(request, adminToken, resourceId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
