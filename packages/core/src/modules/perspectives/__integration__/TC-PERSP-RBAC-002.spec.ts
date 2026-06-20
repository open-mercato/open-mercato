import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  createRoleFixture,
  deleteRoleIfExists,
  createUserFixture,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

export const integrationMeta = {
  dependsOnModules: ['perspectives'],
};

/**
 * TC-PERSP-RBAC-002 (#2491): perspectives.role_defaults guards the role operations inside
 * POST /api/perspectives/[tableId].
 *
 * The handler checks `rbac.userHasAllFeatures(..., ['perspectives.role_defaults'])` whenever
 * applyToRoles/clearRoleIds are present and returns 403 with
 * `{ requiredFeatures: ['perspectives.role_defaults'] }` if the caller lacks it — while a
 * personal-only save (no role ops) still succeeds with just perspectives.use. The fixture
 * user is granted only perspectives.use (mirroring the seeded employee), so it can save its
 * own perspective but cannot push defaults onto roles.
 */
test.describe('TC-PERSP-RBAC-002: perspectives.role_defaults gates role operations in POST', () => {
  test('allows personal save but blocks applyToRoles for a user lacking perspectives.role_defaults', async ({ request }) => {
    test.slow();
    const stamp = Date.now();
    const password = 'Secret123!';
    const email = `qa-persp-rbac-002-${stamp}@example.com`;
    const tableId = `qa-persp-rbac-002-${stamp}`;

    let adminToken: string | null = null;
    let employeeRoleId: string | null = null;
    let targetRoleId: string | null = null;
    let userId: string | null = null;
    let personalId: string | null = null;

    try {
      adminToken = await getAuthToken(request, 'admin');
      const { organizationId } = getTokenContext(adminToken);

      employeeRoleId = await createRoleFixture(request, adminToken, { name: `TC-PERSP-RBAC-002 Employee ${stamp}` });
      targetRoleId = await createRoleFixture(request, adminToken, { name: `TC-PERSP-RBAC-002 Target ${stamp}` });
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [employeeRoleId],
      });
      // Grant ONLY perspectives.use (use without role_defaults).
      await setUserAclVisibility(request, adminToken, {
        userId,
        features: ['perspectives.use'],
        organizations: [organizationId],
      });
      const userToken = await getAuthToken(request, email, password);

      // applyToRoles requires perspectives.role_defaults -> 403 naming the missing feature.
      const denied = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token: userToken,
        data: { name: `Role Attempt ${stamp}`, settings: { pageSize: 10 }, applyToRoles: [targetRoleId] },
      });
      expect(denied.status(), 'applyToRoles without role_defaults must be forbidden').toBe(403);
      const deniedBody = await readJsonSafe<{ requiredFeatures?: unknown }>(denied);
      expect(
        Array.isArray(deniedBody?.requiredFeatures) && (deniedBody!.requiredFeatures as string[]).includes('perspectives.role_defaults'),
        'forbidden response names perspectives.role_defaults',
      ).toBe(true);

      // Personal-only save still works with just perspectives.use.
      const allowed = await apiRequest(request, 'POST', `/api/perspectives/${encodeURIComponent(tableId)}`, {
        token: userToken,
        data: { name: `Personal OK ${stamp}`, settings: { pageSize: 10 } },
      });
      expect(allowed.status(), 'personal-only save succeeds with perspectives.use').toBe(200);
      const allowedBody = await readJsonSafe<{ perspective?: { id?: string }; rolePerspectives?: unknown[] }>(allowed);
      personalId = allowedBody?.perspective?.id ?? null;
      expect(typeof personalId, 'personal save returns an id').toBe('string');
      expect(allowedBody?.rolePerspectives ?? [], 'no role perspectives created on personal-only save').toEqual([]);
    } finally {
      if (personalId) {
        const userToken = await getAuthToken(request, email, password).catch(() => null);
        if (userToken) {
          await apiRequest(request, 'DELETE', `/api/perspectives/${encodeURIComponent(tableId)}/${personalId}`, { token: userToken }).catch(() => {});
        }
      }
      await deleteUserIfExists(request, adminToken, userId);
      await deleteRoleIfExists(request, adminToken, employeeRoleId);
      await deleteRoleIfExists(request, adminToken, targetRoleId);
    }
  });
});
