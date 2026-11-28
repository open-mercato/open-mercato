import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-051 [P0]: User ACL grants are bounded by the actor's effective ACL (#2238)
 *
 * A non-superadmin actor with `auth.acl.manage` can edit user-level ACLs, but must not
 * be able to grant features they do not personally hold. This covers the vertical
 * privilege escalation where PUT /api/auth/users/acl previously persisted arbitrary
 * module wildcards such as `sales.*`.
 *
 * The refusals are localized from the request locale (#7368): the same denial reads in
 * Polish under `locale=pl` and stays byte-identical in English under `locale=en`.
 */
const MANAGE_ACL_FEATURE = 'auth.acl.manage';
const OUT_OF_SCOPE_FEATURE = 'sales.*';
const POLISH = { Cookie: 'locale=pl' };
const ENGLISH = { Cookie: 'locale=en' };

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

      const deniedGrantData = {
        userId: targetUserId,
        features: [MANAGE_ACL_FEATURE, OUT_OF_SCOPE_FEATURE],
      };
      const deniedGrant = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: actorToken,
        data: deniedGrantData,
        headers: ENGLISH,
      });
      const deniedBody = await readJsonSafe<{ error?: string }>(deniedGrant);
      expect(deniedGrant.status(), 'out-of-scope user ACL grant should be forbidden').toBe(403);
      expect(deniedBody?.error, 'English error should be unchanged and name the denied wildcard').toBe(
        `Cannot grant feature wildcard ${OUT_OF_SCOPE_FEATURE}.`,
      );

      const deniedGrantPolish = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: actorToken,
        data: deniedGrantData,
        headers: POLISH,
      });
      const deniedPolishBody = await readJsonSafe<{ error?: string }>(deniedGrantPolish);
      expect(deniedGrantPolish.status(), 'localized denial keeps the 403 status').toBe(403);
      expect(deniedPolishBody?.error, 'Polish error should be translated and name the denied wildcard').toBe(
        `Nie można nadać uprawnień z symbolem wieloznacznym ${OUT_OF_SCOPE_FEATURE}.`,
      );

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

  test('organization-scoped actor gets a localized refusal for a user outside its organizations', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');
    const tenantId = expectId(getTokenScope(adminToken).tenantId, 'admin token should carry a tenant id');
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const actorEmail = `qa-tc-auth-051-scoped-actor-${stamp}@example.com`;
    const password = 'StrongSecret123!';
    let actorOrganizationId: string | null = null;
    let siblingOrganizationId: string | null = null;
    let actorUserId: string | null = null;
    let targetUserId: string | null = null;
    let foreignTenantId: string | null = null;
    let foreignOrganizationId: string | null = null;
    let foreignUserId: string | null = null;

    try {
      actorOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-AUTH-051 Actor Org ${stamp}`,
        tenantId,
      });
      siblingOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-AUTH-051 Sibling Org ${stamp}`,
        tenantId,
      });

      actorUserId = await createUserFixture(request, superadminToken, {
        email: actorEmail,
        password,
        organizationId: actorOrganizationId,
        roles: [],
        name: 'QA TC-AUTH-051 Scoped Actor',
      });
      await setUserAclVisibility(request, superadminToken, {
        userId: actorUserId,
        features: [MANAGE_ACL_FEATURE],
        organizations: [actorOrganizationId],
      });
      targetUserId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-auth-051-sibling-target-${stamp}@example.com`,
        password,
        organizationId: siblingOrganizationId,
        roles: [],
        name: 'QA TC-AUTH-051 Sibling Target',
      });

      const actorToken = await getAuthToken(request, actorEmail, password);
      const targetAclPath = `/api/auth/users/acl?userId=${encodeURIComponent(targetUserId)}`;

      const readEnglish = await apiRequest(request, 'GET', targetAclPath, { token: actorToken, headers: ENGLISH });
      expect(readEnglish.status(), 'reading a user outside the actor organizations should be forbidden').toBe(403);
      expect((await readJsonSafe<{ error?: string }>(readEnglish))?.error, 'English error should be unchanged').toBe(
        'Not authorized to access this user.',
      );

      const readPolish = await apiRequest(request, 'GET', targetAclPath, { token: actorToken, headers: POLISH });
      expect(readPolish.status(), 'localized denial keeps the 403 status').toBe(403);
      expect((await readJsonSafe<{ error?: string }>(readPolish))?.error, 'Polish error should be translated').toBe(
        'Brak uprawnień do dostępu do tego użytkownika.',
      );

      const writePolish = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: actorToken,
        data: { userId: targetUserId, features: [MANAGE_ACL_FEATURE] },
        headers: POLISH,
      });
      expect(writePolish.status(), 'updating a user outside the actor organizations should be forbidden').toBe(403);
      expect((await readJsonSafe<{ error?: string }>(writePolish))?.error, 'Polish error should be translated').toBe(
        'Brak uprawnień do dostępu do tego użytkownika.',
      );

      const targetAcl = await readJsonSafe<{ hasCustomAcl?: boolean; features?: string[] }>(
        await apiRequest(request, 'GET', targetAclPath, { token: superadminToken }),
      );
      expect(targetAcl?.hasCustomAcl ?? false, 'denied update should not create a custom ACL').toBe(false);
      expect(targetAcl?.features ?? [], 'denied feature should not persist').not.toContain(MANAGE_ACL_FEATURE);

      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `QA TC-AUTH-051 Foreign ${stamp}` },
      });
      expect(tenantResponse.status(), 'POST /api/directory/tenants should return 201').toBe(201);
      foreignTenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'foreign tenant id');
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-AUTH-051 Foreign Org ${stamp}`,
        tenantId: foreignTenantId,
      });
      foreignUserId = await createUserFixture(request, superadminToken, {
        email: `qa-tc-auth-051-foreign-target-${stamp}@example.com`,
        password,
        organizationId: foreignOrganizationId,
        roles: [],
        name: 'QA TC-AUTH-051 Foreign Target',
      });
      const foreignAclPath = `/api/auth/users/acl?userId=${encodeURIComponent(foreignUserId)}`;

      const foreignEnglish = await apiRequest(request, 'GET', foreignAclPath, { token: actorToken, headers: ENGLISH });
      expect(foreignEnglish.status(), 'a user of another tenant should read as not found').toBe(404);
      expect((await readJsonSafe<{ error?: string }>(foreignEnglish))?.error, 'English error should be unchanged').toBe(
        'User not found',
      );

      const foreignPolish = await apiRequest(request, 'GET', foreignAclPath, { token: actorToken, headers: POLISH });
      expect(foreignPolish.status(), 'localized not-found keeps the 404 status').toBe(404);
      expect((await readJsonSafe<{ error?: string }>(foreignPolish))?.error, 'Polish error should be translated').toBe(
        'Nie znaleziono użytkownika',
      );
    } finally {
      await deleteUserIfExists(request, superadminToken, foreignUserId);
      await deleteUserIfExists(request, superadminToken, targetUserId);
      await deleteUserIfExists(request, superadminToken, actorUserId);
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId);
      await deleteOrganizationIfExists(request, superadminToken, siblingOrganizationId);
      await deleteOrganizationIfExists(request, superadminToken, actorOrganizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId);
    }
  });
});
