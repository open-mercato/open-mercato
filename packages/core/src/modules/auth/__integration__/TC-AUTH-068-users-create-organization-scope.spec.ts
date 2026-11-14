import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
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
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenScope,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';

/**
 * TC-AUTH-068: `POST /api/auth/users` enforces the actor's organization scope (#7238).
 *
 * An actor restricted to one organization could create a confirmed staff user in any other
 * organization of the same tenant: the create route checked only role grants (and only when
 * `roles` was sent), and the `auth.users.create` command checked only the tenant. The update path
 * already ran `assertActorCanAssignUserDestination`. Create now runs it as well, with or without
 * roles, while a foreign-tenant organization keeps failing with the same 404.
 *
 * Covers: POST /api/auth/users (in-scope, descendant, out-of-scope with and without roles,
 * foreign tenant) and GET /api/auth/users (superadmin listing proves no row was written).
 */
const PASSWORD = 'StrongSecret123!';

type CreateResponse = { id?: string; error?: string };
type UserListResponse = { items?: Array<{ email?: string }> };

const BASE_URL = process.env.BASE_URL?.trim() || null;

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path;
}

async function listOrganizationUserEmails(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  organizationId: string,
): Promise<string[]> {
  const response = await request.fetch(
    resolveUrl(`/api/auth/users?organizationId=${encodeURIComponent(organizationId)}&pageSize=100`),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Cookie: `om_selected_tenant=${encodeURIComponent(tenantId)}; om_selected_org=__all__`,
      },
    },
  );
  expect(response.status(), 'GET /api/auth/users should return 200').toBe(200);
  const body = (await readJsonSafe<UserListResponse>(response)) ?? {};
  return (body.items ?? [])
    .map((item) => (typeof item.email === 'string' ? item.email : ''))
    .filter((email) => email.length > 0);
}

test.describe('TC-AUTH-068: user create enforces the actor organization scope', () => {
  test('an organization-scoped actor creates users only inside its organization scope', async ({ request }) => {
    test.slow();
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');
    const tenantId = expectId(getTokenScope(adminToken).tenantId, 'admin token should carry a tenant id');
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const createdUserIds: string[] = [];
    let parentOrganizationId: string | null = null;
    let childOrganizationId: string | null = null;
    let siblingOrganizationId: string | null = null;
    let foreignTenantId: string | null = null;
    let foreignOrganizationId: string | null = null;
    let roleId: string | null = null;

    const createAsActor = async (
      actorToken: string,
      organizationId: string,
      label: string,
      roles?: string[],
    ): Promise<{ response: APIResponse; email: string }> => {
      const email = `qa-auth-068-${label}-${stamp}@example.com`;
      const data: Record<string, unknown> = { email, password: PASSWORD, organizationId };
      if (roles) data.roles = roles;
      const response = await apiRequest(request, 'POST', '/api/auth/users', { token: actorToken, data });
      const body = await readJsonSafe<CreateResponse>(response);
      if (response.status() === 201 && typeof body?.id === 'string') createdUserIds.push(body.id);
      return { response, email };
    };

    try {
      parentOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA AUTH 068 Parent ${stamp}`,
        tenantId,
      });
      childOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA AUTH 068 Child ${stamp}`,
        tenantId,
        parentId: parentOrganizationId,
      });
      siblingOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA AUTH 068 Sibling ${stamp}`,
        tenantId,
      });

      roleId = await createRoleFixture(request, superadminToken, { name: `qa-auth-068-role-${stamp}`, tenantId });
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['auth.users.list'],
        organizations: [parentOrganizationId],
      });

      const actorEmail = `qa-auth-068-actor-${stamp}@example.com`;
      const actorUserId = await createUserFixture(request, superadminToken, {
        email: actorEmail,
        password: PASSWORD,
        organizationId: parentOrganizationId,
        roles: [],
      });
      createdUserIds.push(actorUserId);
      await setUserAclVisibility(request, superadminToken, {
        userId: actorUserId,
        features: ['auth.users.create', 'auth.users.list'],
        organizations: [parentOrganizationId],
      });
      const actorToken = await getAuthToken(request, actorEmail, PASSWORD);

      const inScope = await createAsActor(actorToken, parentOrganizationId, 'parent');
      expect(inScope.response.status(), 'create inside the actor organization should return 201').toBe(201);

      const inScopeWithRole = await createAsActor(actorToken, parentOrganizationId, 'parent-role', [roleId]);
      expect(inScopeWithRole.response.status(), 'create inside the actor organization with a grantable role should return 201').toBe(201);

      const descendant = await createAsActor(actorToken, childOrganizationId, 'child');
      expect(descendant.response.status(), 'create in a descendant organization should return 201').toBe(201);

      const outOfScope = await createAsActor(actorToken, siblingOrganizationId, 'sibling');
      expect.soft(outOfScope.response.status(), 'create outside the actor organization scope should return 403').toBe(403);

      const outOfScopeWithRole = await createAsActor(actorToken, siblingOrganizationId, 'sibling-role', [roleId]);
      expect.soft(outOfScopeWithRole.response.status(), 'create outside the actor organization scope with roles should return 403').toBe(403);

      const siblingEmails = await listOrganizationUserEmails(request, superadminToken, tenantId, siblingOrganizationId);
      expect(siblingEmails, 'a denied create must not write a user without roles').not.toContain(outOfScope.email);
      expect(siblingEmails, 'a denied create must not write a user with roles').not.toContain(outOfScopeWithRole.email);

      const parentEmails = await listOrganizationUserEmails(request, superadminToken, tenantId, parentOrganizationId);
      expect(parentEmails, 'the listing reaches users created in scope').toContain(inScope.email);

      const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
        token: superadminToken,
        data: { name: `QA AUTH 068 Foreign ${stamp}` },
      });
      expect(tenantResponse.status(), 'POST /api/directory/tenants should return 201').toBe(201);
      foreignTenantId = expectId((await readJsonSafe<CreateResponse>(tenantResponse))?.id, 'foreign tenant id');
      foreignOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA AUTH 068 Foreign Org ${stamp}`,
        tenantId: foreignTenantId,
      });

      const crossTenant = await createAsActor(actorToken, foreignOrganizationId, 'foreign');
      expect(crossTenant.response.status(), 'a foreign-tenant organization should still return 404').toBe(404);
      const crossTenantBody = await readJsonSafe<CreateResponse>(crossTenant.response);
      expect(crossTenantBody?.error).toBe('Organization not found');
      const foreignEmails = await listOrganizationUserEmails(request, superadminToken, foreignTenantId, foreignOrganizationId);
      expect(foreignEmails, 'a denied cross-tenant create must not write a user').not.toContain(crossTenant.email);
    } finally {
      for (const userId of [...createdUserIds].reverse()) {
        await deleteUserIfExists(request, superadminToken, userId);
      }
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteOrganizationIfExists(request, superadminToken, childOrganizationId);
      await deleteOrganizationIfExists(request, superadminToken, siblingOrganizationId);
      await deleteOrganizationIfExists(request, superadminToken, parentOrganizationId);
      await deleteOrganizationIfExists(request, superadminToken, foreignOrganizationId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId);
    }
  });
});
