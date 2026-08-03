import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupRole,
  createRoleFixture,
  getRecordLockSettings,
  getRoleUpdatedAt,
  saveRecordLockSettings,
  updateRoleName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-AUTH-role: Phase 5 record-locks coverage for the auth ROLE entity
 * (`auth.role`).
 *
 * Roles are a `makeCrudRoute` resource guarded on their OWN row by the CRUD
 * mutation-guard decorator. A stale role edit 409s; a fresh-version edit
 * succeeds. The role edit screen publishes `backend:record:current` presence so
 * the merge dialog surfaces the concurrent-edit 409. The ACL routes
 * (`api/users/acl`, `api/roles/acl`) carry their own separate updatedAt
 * versioning and are intentionally NOT exercised here.
 *
 * Self-contained: creates its own role via the API, restores settings and
 * deletes the role in `finally`.
 */
test.describe('TC-LOCK-AUTH-role: optimistic conflict on role edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale role edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let roleId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['auth.role'],
      });

      roleId = await createRoleFixture(request, adminToken, `QA Lock Role ${suffix}`);

      const baseUpdatedAt = await getRoleUpdatedAt(request, adminToken, roleId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateRoleName(request, adminToken, roleId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateRoleName(request, adminToken, roleId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getRoleUpdatedAt(request, adminToken, roleId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateRoleName(request, adminToken, roleId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupRole(request, adminToken, roleId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
