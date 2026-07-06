import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupStaffTeam,
  createStaffTeamFixture,
  getRecordLockSettings,
  getStaffTeamUpdatedAt,
  saveRecordLockSettings,
  updateStaffTeamName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-STAFF-team: Phase 5 record-locks coverage for the staff TEAM entity
 * (`staff.team`).
 *
 * Teams are a `makeCrudRoute` resource guarded on their OWN row by the CRUD
 * mutation-guard decorator. A stale team edit 409s; a fresh-version edit
 * succeeds. The team edit screen publishes `backend:record:current` presence so
 * the merge dialog surfaces the concurrent-edit 409. Leave-request accept/reject
 * status transitions are decision-state (deferred to the command-layer sweep)
 * and tag assign/unassign are junctions — neither is exercised here.
 *
 * Self-contained: creates its own team via the API, restores settings and
 * deletes the team in `finally`.
 */
test.describe('TC-LOCK-STAFF-team: optimistic conflict on team edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale team edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let teamId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['staff.team'],
      });

      teamId = await createStaffTeamFixture(request, adminToken, `QA Lock Team ${suffix}`);

      const baseUpdatedAt = await getStaffTeamUpdatedAt(request, adminToken, teamId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateStaffTeamName(request, adminToken, teamId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateStaffTeamName(request, adminToken, teamId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getStaffTeamUpdatedAt(request, adminToken, teamId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateStaffTeamName(request, adminToken, teamId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupStaffTeam(request, adminToken, teamId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
