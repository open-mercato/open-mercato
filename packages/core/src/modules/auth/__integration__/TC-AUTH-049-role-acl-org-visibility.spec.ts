import { expect, test } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-049 [P2]: Role ACL organization visibility (#2464)
 *
 * PUT /api/auth/roles/acl persists the role's `organizations` visibility list and GET reads it
 * back (null = no restriction = all orgs). This is the real, verified contract.
 *
 * NOTE on the issue's end-to-end premise: GET /api/directory/organizations is filtered by the
 * caller's TENANT only — it does NOT apply the role's stored `organizations` ACL (verified in
 * directory/api/organizations/route.ts). So a user whose role is restricted to org1 still sees
 * every org in the tenant. This spec asserts that real behaviour rather than the issue's
 * (incorrect) "user sees only org1" assertion.
 */
type RoleAclResponse = { isSuperAdmin?: boolean; features?: string[]; organizations?: string[] | null };
type OrganizationListResponse = { items?: Array<{ id?: string | null }> };

const sorted = (values: string[]): string[] => [...values].sort();

test.describe('TC-AUTH-049: role ACL organization visibility (#2464)', () => {
  test('persists and round-trips the org visibility list; directory list stays tenant-scoped', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const userEmail = `qa-tc-auth-049-${stamp}@example.com`;
    const userPassword = 'StrongSecret123!';
    let org1Id: string | null = null;
    let org2Id: string | null = null;
    let roleId: string | null = null;
    let userId: string | null = null;

    const setRoleAcl = async (organizations: string[] | null): Promise<void> => {
      const res = await apiRequest(request, 'PUT', '/api/auth/roles/acl', {
        token: superadminToken,
        data: { roleId, features: ['directory.*'], organizations },
      });
      expect(res.status(), 'PUT role ACL should return 200').toBe(200);
      const body = await readJsonSafe<{ ok?: boolean }>(res);
      expect(body?.ok, 'PUT role ACL should report ok=true').toBe(true);
    };
    const getRoleAcl = async (): Promise<RoleAclResponse> => {
      const res = await apiRequest(request, 'GET', `/api/auth/roles/acl?roleId=${encodeURIComponent(roleId ?? '')}`, {
        token: superadminToken,
      });
      expect(res.status(), 'GET role ACL should return 200').toBe(200);
      return (await readJsonSafe<RoleAclResponse>(res)) ?? {};
    };

    try {
      // Resolve a real tenant for the new orgs/role: superadmin org creation needs a target
      // tenant. Prefer the superadmin's own tenant; fall back to an existing org's tenant.
      let tenantId = getTokenContext(superadminToken).tenantId;
      if (!tenantId) {
        const existingOrgs = await apiRequest(request, 'GET', '/api/directory/organizations?page=1&pageSize=1', {
          token: superadminToken,
        });
        const existing = (await readJsonSafe<{ items?: Array<{ tenantId?: string | null }> }>(existingOrgs))?.items?.[0];
        tenantId = existing?.tenantId ?? '';
      }
      const tenantOpt = tenantId ? { tenantId } : {};

      org1Id = await createOrganizationFixture(request, superadminToken, { name: `qa-tc-auth-049-org1-${stamp}`, ...tenantOpt });
      org2Id = await createOrganizationFixture(request, superadminToken, { name: `qa-tc-auth-049-org2-${stamp}`, ...tenantOpt });
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-auth-049-${stamp}`, ...tenantOpt });

      // Restrict the role to org1 and confirm persistence + round-trip.
      await setRoleAcl([org1Id]);
      const restricted = await getRoleAcl();
      expect(restricted.organizations ?? [], 'org visibility should persist as [org1]').toEqual([org1Id]);
      expect(restricted.features ?? [], 'granted feature should round-trip').toContain('directory.*');

      // End-to-end: an org1 user with the org-restricted role still sees BOTH tenant orgs,
      // because the directory list is tenant-scoped and ignores the role's org ACL.
      userId = await createUserFixture(request, superadminToken, {
        email: userEmail,
        password: userPassword,
        organizationId: org1Id,
        roles: [roleId],
        name: 'QA TC-AUTH-049',
      });
      const userToken = await getAuthToken(request, userEmail, userPassword);
      const dirRes = await apiRequest(request, 'GET', '/api/directory/organizations?page=1&pageSize=100', {
        token: userToken,
      });
      expect(dirRes.status(), 'org-restricted user can list directory organizations').toBe(200);
      const dirBody = await readJsonSafe<OrganizationListResponse>(dirRes);
      const visibleOrgIds = (dirBody?.items ?? []).map((item) => item.id ?? '');
      expect(visibleOrgIds, 'restricted org should be visible').toContain(org1Id);
      expect(visibleOrgIds, 'non-restricted org is still visible (ACL not enforced on list)').toContain(org2Id);

      // Clearing the restriction (null) means "all orgs".
      await setRoleAcl(null);
      const cleared = await getRoleAcl();
      expect(cleared.organizations, 'null org visibility means no restriction').toBeNull();

      // Multiple orgs persist as a set.
      await setRoleAcl([org1Id, org2Id]);
      const multi = await getRoleAcl();
      expect(sorted(multi.organizations ?? []), 'both orgs should persist').toEqual(sorted([org1Id, org2Id]));
    } finally {
      await deleteUserIfExists(request, superadminToken, userId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, org1Id);
      await deleteOrganizationIfExists(request, superadminToken, org2Id);
    }
  });
});
