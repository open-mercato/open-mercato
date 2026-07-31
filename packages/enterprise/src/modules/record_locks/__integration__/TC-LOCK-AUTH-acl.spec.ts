import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupRole,
  createRoleFixture,
  getRecordLockSettings,
  getRoleAclUpdatedAt,
  saveRecordLockSettings,
  updateRoleAcl,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-AUTH-acl: Phase 6b record-locks coverage for the ROLE ACL surface
 * (`auth.role_acl`).
 *
 * Role ACLs are versioned separately from the role row and written via the
 * hand-rolled `PUT /api/auth/roles/acl` route, which (after Phase 6b) routes
 * through the async DI-aware seam `enforceCommandOptimisticLockWithGuards` on the
 * ACL row's `updated_at`. The lock only engages once an ACL row exists (the first
 * grant has no prior version). A stale ACL overwrite 409s; a fresh-version
 * overwrite succeeds. Distinct from TC-LOCK-AUTH-role, which covers the role row.
 *
 * Self-contained: creates its own role, restores settings and deletes the role
 * (which removes its ACL) in `finally`.
 */
test.describe('TC-LOCK-AUTH-acl: optimistic conflict on role ACL edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale role-ACL edit 409s; a fresh-version edit succeeds', async ({ request }) => {
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
        enabledResources: ['auth.role_acl'],
      });

      roleId = await createRoleFixture(request, adminToken, `QA Lock ACL Role ${suffix}`);

      // First grant — creates the ACL row. With the Phase-1 onCreate fix this
      // already stamps `updatedAt`, so a version exists to read as the base.
      const firstGrant = await updateRoleAcl(request, adminToken, {
        roleId,
        features: ['business_rules.view'],
      });
      expect(firstGrant.status).toBeLessThan(300);

      const baseUpdatedAt = await getRoleAclUpdatedAt(request, adminToken, roleId);
      expect(baseUpdatedAt).toBeTruthy();

      // Incoming writer wins and advances the ACL version. Under full-suite
      // timing the advance can land on the same timestamp, so re-read and force a
      // distinct second advance until the version moves — making the stale-edit
      // 409 deterministic, not timing-dependent.
      let latestUpdatedAt = baseUpdatedAt;
      const incoming = await updateRoleAcl(
        request,
        adminToken,
        { roleId, features: ['business_rules.view', 'business_rules.manage'] },
        latestUpdatedAt,
      );
      expect(incoming.status).toBeLessThan(300);
      latestUpdatedAt = await getRoleAclUpdatedAt(request, adminToken, roleId);
      expect(latestUpdatedAt).toBeTruthy();
      let toggle = true;
      while (latestUpdatedAt === baseUpdatedAt) {
        const advance = await updateRoleAcl(
          request,
          adminToken,
          { roleId, features: toggle ? ['business_rules.view'] : ['business_rules.view', 'business_rules.manage'] },
          latestUpdatedAt,
        );
        expect(advance.status).toBeLessThan(300);
        toggle = !toggle;
        latestUpdatedAt = await getRoleAclUpdatedAt(request, adminToken, roleId);
        expect(latestUpdatedAt).toBeTruthy();
      }
      expect(latestUpdatedAt, 'an incoming grant should advance the ACL version').not.toBe(baseUpdatedAt);

      // Stale writer replays the now-outdated version → conflict.
      const stale = await updateRoleAcl(
        request,
        adminToken,
        { roleId, features: ['business_rules.view'] },
        baseUpdatedAt,
      );
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getRoleAclUpdatedAt(request, adminToken, roleId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateRoleAcl(
        request,
        adminToken,
        { roleId, features: ['business_rules.view', 'business_rules.manage'] },
        freshUpdatedAt,
      );
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupRole(request, adminToken, roleId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
