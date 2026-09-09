import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomInt } from 'node:crypto';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-057 [P1]: `GET /api/auth/users?roleId=` scopes the role-link lookup (#4914, PR #5027).
 *
 * PR #5027 replaced the unscoped `em.find(UserRole, { role: { $in: roleIds } })` prefilter with a
 * scoped one that expresses the caller's effective tenant/organization scope as a predicate on the
 * `UserRole.user` relation. MikroORM compiles that relation-nested `$and` into a join against
 * `users`; the unit suite asserts the filter object handed to the EntityManager, but nothing
 * executed the resulting SQL, so a MikroORM that refused to compile the predicate would break
 * every role-filtered users request with the whole suite still green.
 *
 * This spec closes that gap: it drives the real endpoint against a real database so the query is
 * actually compiled and executed, and it pins the isolation the filter exists to provide.
 * Covers: GET /api/auth/users (`?roleId=` role filter, tenant-scoped and superadmin paths).
 */
type CreateResponse = { id?: string };
type UserListItem = { id?: string };
type UserListResponse = { items?: UserListItem[]; total?: number };

const BASE_URL = process.env.BASE_URL?.trim() || null;

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path;
}

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } });
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201);
  const body = await readJsonSafe<CreateResponse>(response);
  return expectId(body?.id, 'Tenant create response should contain an id');
}

async function listUserIdsByRole(
  request: APIRequestContext,
  token: string,
  roleId: string,
  selectedTenantId?: string,
): Promise<string[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (selectedTenantId) {
    headers.Cookie = [
      `om_selected_tenant=${encodeURIComponent(selectedTenantId)}`,
      `om_selected_org=${encodeURIComponent('__all__')}`,
    ].join('; ');
  }
  const response = await request.fetch(
    resolveUrl(`/api/auth/users?roleId=${encodeURIComponent(roleId)}&pageSize=100`),
    { method: 'GET', headers },
  );
  expect(response.status(), 'GET /api/auth/users?roleId= should return 200').toBe(200);
  const body = (await readJsonSafe<UserListResponse>(response)) ?? {};
  return (body.items ?? [])
    .map((item) => (typeof item.id === 'string' ? item.id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

test.describe('TC-AUTH-057: users role filter scope (#4914)', () => {
  test('returns only in-scope holders of the filtered role and stays empty outside that scope', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    const { organizationId, tenantId } = getTokenContext(adminToken);
    expectId(organizationId, 'admin token should carry a home organization');
    expectId(tenantId, 'admin token should carry a tenant');

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    let roleId: string | null = null;
    let roleHolderId: string | null = null;
    let nonHolderId: string | null = null;
    let foreignTenantId: string | null = null;

    try {
      // Setup: a role in the admin's own tenant, one user holding it and one user that does not.
      roleId = await createRoleFixture(request, adminToken, { name: `QA AUTH 057 Role ${stamp}` });
      roleHolderId = await createUserFixture(request, adminToken, {
        email: `qa-tc-auth-057-holder-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [roleId],
      });
      nonHolderId = await createUserFixture(request, adminToken, {
        email: `qa-tc-auth-057-other-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId,
        roles: [],
      });

      // T1: the role filter executes against the database and returns exactly the holder.
      // This is the assertion the unit suite cannot make: the relation-nested scope predicate is
      // compiled and run by the real ORM, so a predicate the driver rejects fails here.
      const scopedIds = await listUserIdsByRole(request, adminToken, roleId);
      expect(scopedIds, 'the role holder must be returned to a tenant-scoped admin').toContain(roleHolderId);
      expect(scopedIds, 'a user without the role must not be returned').not.toContain(nonHolderId);

      // T2: the same role filter, evaluated by a superadmin whose selected tenant is a DIFFERENT
      // tenant, must return nothing — the role's only links live outside the selected scope, and
      // the scoped lookup is what keeps them out of the candidate set.
      foreignTenantId = await createTenant(request, superadminToken, `QA AUTH 057 Tenant B ${stamp}`);
      const foreignScopeIds = await listUserIdsByRole(request, superadminToken, roleId, foreignTenantId);
      expect(
        foreignScopeIds,
        'a role whose links all live in another tenant must yield no users in the selected tenant',
      ).toEqual([]);

      // T3: with the role's own tenant selected, the superadmin sees the holder again — proving the
      // negative assertion in T2 came from the scope and not from a query that never matches.
      const ownScopeIds = await listUserIdsByRole(request, superadminToken, roleId, tenantId);
      expect(
        ownScopeIds,
        'selecting the role owning tenant should surface the holder for a superadmin',
      ).toContain(roleHolderId);
    } finally {
      await deleteUserIfExists(request, superadminToken, roleHolderId);
      await deleteUserIfExists(request, superadminToken, nonHolderId);
      await deleteRoleIfExists(request, superadminToken, roleId);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', foreignTenantId);
    }
  });
});
