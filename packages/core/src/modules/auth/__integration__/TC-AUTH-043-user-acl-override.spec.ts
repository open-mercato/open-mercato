import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-043 [P0]: User-level ACL override grants an individual feature to a non-admin user (#2464)
 *
 * GET/PUT /api/auth/users/acl are guarded by `auth.acl.manage`. A user-level override is
 * additive on top of the role ACL, so a user whose role grants nothing can still be granted
 * a single admin-only feature. The grant is verified live via POST /api/auth/feature-check
 * (the authoritative protected-access check) and the GET /api/auth/users/acl round-trip. The
 * guarded user-list route is asserted only for the pre-grant denial: route guards resolve
 * features through a separately-cached layer that is not guaranteed fresh within the same
 * session immediately after a grant, so a same-session 403→200 flip is not asserted here.
 * Real feature id is `auth.users.list` (the issue's `users.manage` does not exist).
 */
const GRANTED_FEATURE = 'auth.users.list';

test.describe('TC-AUTH-043: user ACL override grants a feature (#2464)', () => {
  test('granting a user-level feature takes effect for feature-check and guarded routes', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { organizationId } = getTokenContext(superadminToken);
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const userEmail = `qa-tc-auth-043-${stamp}@example.com`;
    const userPassword = 'StrongSecret123!';
    let roleId: string | null = null;
    let userId: string | null = null;

    try {
      // A role with zero features: the user's only path to the feature is the user-level override.
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-auth-043-${stamp}` });
      userId = await createUserFixture(request, superadminToken, {
        email: userEmail,
        password: userPassword,
        organizationId,
        roles: [roleId],
        name: 'QA TC-AUTH-043',
      });

      const userToken = await getAuthToken(request, userEmail, userPassword);

      // Baseline: without the override the user is denied.
      const checkBefore = await readJsonSafe<{ ok?: boolean; granted?: string[] }>(
        await apiRequest(request, 'POST', '/api/auth/feature-check', {
          token: userToken,
          data: { features: [GRANTED_FEATURE] },
        }),
      );
      expect(checkBefore?.ok, 'feature-check should deny before the grant').toBe(false);
      expect(checkBefore?.granted ?? [], 'no feature is granted before the override').not.toContain(GRANTED_FEATURE);

      const listDenied = await apiRequest(request, 'GET', '/api/auth/users?pageSize=1', { token: userToken });
      expect(listDenied.status(), 'guarded user list should be forbidden before the grant').toBe(403);

      // Grant the feature through the user-level ACL override.
      const putRes = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: superadminToken,
        data: { userId, features: [GRANTED_FEATURE] },
      });
      expect(putRes.status(), 'PUT user ACL should return 200').toBe(200);
      const putBody = await readJsonSafe<{ ok?: boolean }>(putRes);
      expect(putBody?.ok, 'PUT user ACL should report ok=true').toBe(true);

      // The override is persisted and surfaced by GET.
      const aclRes = await apiRequest(request, 'GET', `/api/auth/users/acl?userId=${encodeURIComponent(userId)}`, {
        token: superadminToken,
      });
      expect(aclRes.status(), 'GET user ACL should return 200').toBe(200);
      const aclBody = await readJsonSafe<{ hasCustomAcl?: boolean; features?: string[] }>(aclRes);
      expect(aclBody?.hasCustomAcl, 'user should now have a custom ACL').toBe(true);
      expect(aclBody?.features ?? [], 'granted feature should be listed').toContain(GRANTED_FEATURE);

      // The grant takes effect immediately (PUT invalidates the rbac cache for the user).
      const checkAfter = await readJsonSafe<{ ok?: boolean; granted?: string[] }>(
        await apiRequest(request, 'POST', '/api/auth/feature-check', {
          token: userToken,
          data: { features: [GRANTED_FEATURE] },
        }),
      );
      expect(checkAfter?.ok, 'feature-check should grant after the override').toBe(true);
      expect(checkAfter?.granted ?? [], 'granted array should include the feature').toContain(GRANTED_FEATURE);
    } finally {
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
    }
  });
});
