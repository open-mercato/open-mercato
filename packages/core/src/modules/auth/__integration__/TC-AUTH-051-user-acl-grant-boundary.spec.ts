import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-051 [P0]: User ACL grants are bounded by the actor's effective ACL (#2238)
 *
 * A non-superadmin actor with `auth.acl.manage` can edit user-level ACLs, but must not
 * be able to grant features they do not personally hold. This covers the vertical
 * privilege escalation where PUT /api/auth/users/acl previously persisted arbitrary
 * module wildcards such as `sales.*`.
 */
const MANAGE_ACL_FEATURE = 'auth.acl.manage';
const OUT_OF_SCOPE_FEATURE = 'sales.*';

test.describe('TC-AUTH-051: user ACL grant boundary (#2238)', () => {
  test('non-superadmin cannot grant features outside their effective ACL', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const { organizationId } = getTokenContext(superadminToken);
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const actorEmail = `qa-tc-auth-051-actor-${stamp}@example.com`;
    const targetEmail = `qa-tc-auth-051-target-${stamp}@example.com`;
    const password = 'StrongSecret123!';
    let actorRoleId: string | null = null;
    let actorUserId: string | null = null;
    let targetUserId: string | null = null;

    try {
      actorRoleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-auth-051-${stamp}` });
      await setRoleAclFeatures(request, superadminToken, {
        roleId: actorRoleId,
        features: [MANAGE_ACL_FEATURE],
      });

      actorUserId = await createUserFixture(request, superadminToken, {
        email: actorEmail,
        password,
        organizationId,
        roles: [actorRoleId],
        name: 'QA TC-AUTH-051 Actor',
      });
      targetUserId = await createUserFixture(request, superadminToken, {
        email: targetEmail,
        password,
        organizationId,
        roles: [],
        name: 'QA TC-AUTH-051 Target',
      });

      const actorToken = await getAuthToken(request, actorEmail, password);

      const deniedGrant = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: actorToken,
        data: {
          userId: targetUserId,
          features: [MANAGE_ACL_FEATURE, OUT_OF_SCOPE_FEATURE],
        },
      });
      const deniedBody = await readJsonSafe<{ error?: string }>(deniedGrant);
      expect(deniedGrant.status(), 'out-of-scope user ACL grant should be forbidden').toBe(403);
      expect(deniedBody?.error ?? '', 'error should name the denied feature wildcard').toContain(OUT_OF_SCOPE_FEATURE);

      const aclAfterDeniedGrant = await readJsonSafe<{ hasCustomAcl?: boolean; features?: string[] }>(
        await apiRequest(request, 'GET', `/api/auth/users/acl?userId=${encodeURIComponent(targetUserId)}`, {
          token: superadminToken,
        }),
      );
      expect(aclAfterDeniedGrant?.features ?? [], 'denied feature should not persist').not.toContain(OUT_OF_SCOPE_FEATURE);

      const allowedGrant = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: actorToken,
        data: {
          userId: targetUserId,
          features: [MANAGE_ACL_FEATURE],
        },
      });
      const allowedBody = await readJsonSafe<{ ok?: boolean }>(allowedGrant);
      expect(allowedGrant.status(), 'actor may grant features they already hold').toBe(200);
      expect(allowedBody?.ok, 'allowed user ACL update should report ok=true').toBe(true);

      const aclAfterAllowedGrant = await readJsonSafe<{ hasCustomAcl?: boolean; features?: string[] }>(
        await apiRequest(request, 'GET', `/api/auth/users/acl?userId=${encodeURIComponent(targetUserId)}`, {
          token: superadminToken,
        }),
      );
      expect(aclAfterAllowedGrant?.hasCustomAcl, 'target should have a custom ACL after allowed grant').toBe(true);
      expect(aclAfterAllowedGrant?.features ?? [], 'allowed feature should persist').toContain(MANAGE_ACL_FEATURE);
      expect(aclAfterAllowedGrant?.features ?? [], 'out-of-scope feature should still be absent').not.toContain(OUT_OF_SCOPE_FEATURE);
    } finally {
      await deleteUserIfExists(request, superadminToken, targetUserId);
      await deleteUserIfExists(request, superadminToken, actorUserId);
      await deleteRoleIfExists(request, superadminToken, actorRoleId);
    }
  });
});
