import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupOrganization,
  createOrganizationFixture,
  getOrganizationUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateOrganizationName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-DIR-org: Phase 5 record-locks coverage for the directory ORGANIZATION
 * entity (`directory.organization`).
 *
 * Organizations are a `makeCrudRoute` resource guarded on their OWN row by the
 * CRUD mutation-guard decorator. A stale organization edit 409s; a fresh-version
 * edit succeeds. The organization edit screen publishes `backend:record:current`
 * presence so the merge dialog surfaces the concurrent-edit 409. The
 * organization-switcher endpoint is UX state and is intentionally not exercised.
 *
 * Self-contained: creates its own organization scoped to the admin's tenant,
 * restores settings and deletes the organization in `finally`.
 */
test.describe('TC-LOCK-DIR-org: optimistic conflict on organization edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale organization edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let organizationId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['directory.organization'],
      });

      organizationId = await createOrganizationFixture(request, adminToken, `QA Lock Org ${suffix}`);

      const baseUpdatedAt = await getOrganizationUpdatedAt(request, adminToken, organizationId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateOrganizationName(request, adminToken, organizationId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateOrganizationName(request, adminToken, organizationId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getOrganizationUpdatedAt(request, adminToken, organizationId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateOrganizationName(request, adminToken, organizationId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupOrganization(request, adminToken, organizationId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
