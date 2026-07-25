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
  createOrganizationFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures';

/**
 * TC-AUTH-052 [P1]: `auth.users.create` enforces target-tenant scope (#3549, PR #3555).
 *
 * `POST /api/auth/users` derives the target tenant from the request body's `organizationId`.
 * Before the fix a tenant-scoped administrator could pass an organization belonging to ANOTHER
 * tenant and silently create a user there (#3549). The merged guard
 * (`assertTargetTenantInScope(resolveActorTenantScope(ctx), tenantId, 'Organization not found')`)
 * now returns 404 for non-super-admins targeting a foreign tenant, while super-admins remain
 * unaffected.
 *
 * The PR shipped a command-level unit test; this locks the boundary in at the API layer so the
 * isolation guard cannot silently regress. Covers: POST /api/auth/users (create command tenant
 * scope) + GET /api/auth/users (superadmin tenant-scoped listing used to prove non-existence).
 */
type CreateResponse = { id?: string };
type CreateError = { error?: string };
type UserListItem = { id?: string; email?: string; organizationId?: string | null };
type UserListResponse = { items?: UserListItem[] };

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

function createUser(request: APIRequestContext, token: string, organizationId: string, email: string) {
  return apiRequest(request, 'POST', '/api/auth/users', {
    token,
    data: { email, password: 'StrongSecret123!', organizationId },
  });
}

/**
 * Lists users as a super-admin scoped to a specific tenant (via the topbar context cookie) and
 * narrowed to one organization. Returns the decrypted emails so the test can assert presence /
 * absence of a specific account inside tenant B without depending on the unreliable encrypted
 * email search index.
 */
async function listOrganizationUserEmails(
  request: APIRequestContext,
  token: string,
  tenantId: string,
  organizationId: string,
): Promise<string[]> {
  const cookie = [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent('__all__')}`,
  ].join('; ');
  const response = await request.fetch(
    resolveUrl(`/api/auth/users?organizationId=${encodeURIComponent(organizationId)}&pageSize=100`),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
    },
  );
  expect(response.status(), 'GET /api/auth/users (tenant-scoped) should return 200').toBe(200);
  const body = (await readJsonSafe<UserListResponse>(response)) ?? {};
  return (body.items ?? [])
    .map((item) => (typeof item.email === 'string' ? item.email : null))
    .filter((email): email is string => typeof email === 'string' && email.length > 0);
}

test.describe('TC-AUTH-052: create-user tenant scope (#3549)', () => {
  test('blocks a tenant admin from creating a user in a foreign tenant but allows a superadmin', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    // The admin's own org is, by definition, an organization inside the actor's tenant A.
    const { organizationId: organizationA } = getTokenContext(adminToken);
    expectId(organizationA, 'admin token should carry a home organization (tenant A org)');

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`;
    const emailSameTenant = `qa-tc-auth-052-a-${stamp}@example.com`;
    const emailForeignTenant = `qa-tc-auth-052-b-${stamp}@example.com`;

    let tenantB: string | null = null;
    let organizationB: string | null = null;
    let sameTenantUserId: string | null = null;
    let crossTenantUserId: string | null = null;

    try {
      // Setup: a separate tenant B with its own organization, created by the superadmin.
      tenantB = await createTenant(request, superadminToken, `QA AUTH 052 Tenant B ${stamp}`);
      organizationB = await createOrganizationFixture(request, superadminToken, {
        name: `QA AUTH 052 Org B ${stamp}`,
        tenantId: tenantB,
      });

      // T1: admin creates a user within their own tenant → allowed.
      const sameTenantResponse = await createUser(request, adminToken, organizationA, emailSameTenant);
      expect(sameTenantResponse.status(), 'admin create within own tenant should return 201').toBe(201);
      sameTenantUserId = expectId(
        (await readJsonSafe<CreateResponse>(sameTenantResponse))?.id,
        'same-tenant user id',
      );

      // T2: admin targets tenant B's organization → blocked with 404 (guard treats it as not found).
      const crossTenantBlocked = await createUser(request, adminToken, organizationB, emailForeignTenant);
      expect(
        crossTenantBlocked.status(),
        'admin create targeting a foreign-tenant org should return 404',
      ).toBe(404);
      const blockedBody = await readJsonSafe<CreateError>(crossTenantBlocked);
      expect(blockedBody?.error, 'blocked response should report Organization not found').toBe(
        'Organization not found',
      );

      // ...and no user row leaked into tenant B for that email.
      const tenantBEmailsAfterBlock = await listOrganizationUserEmails(
        request,
        superadminToken,
        tenantB,
        organizationB,
      );
      expect(
        tenantBEmailsAfterBlock,
        'blocked cross-tenant create must not have created a user in tenant B',
      ).not.toContain(emailForeignTenant);

      // T3: the same target is allowed for a superadmin (cross-tenant create is their privilege).
      const crossTenantAllowed = await createUser(request, superadminToken, organizationB, emailForeignTenant);
      expect(
        crossTenantAllowed.status(),
        'superadmin create targeting tenant B should return 201',
      ).toBe(201);
      crossTenantUserId = expectId(
        (await readJsonSafe<CreateResponse>(crossTenantAllowed))?.id,
        'cross-tenant user id',
      );

      // Sanity: the tenant-B listing surfaces the user once it legitimately exists, proving the
      // negative assertion in T2 was meaningful (the list query does reach orgB users).
      const tenantBEmailsAfterCreate = await listOrganizationUserEmails(
        request,
        superadminToken,
        tenantB,
        organizationB,
      );
      expect(
        tenantBEmailsAfterCreate,
        'superadmin-created user should be visible in the tenant B listing',
      ).toContain(emailForeignTenant);
    } finally {
      await deleteUserIfExists(request, superadminToken, sameTenantUserId);
      await deleteUserIfExists(request, superadminToken, crossTenantUserId);
      await deleteOrganizationIfExists(request, superadminToken, organizationB);
      await deleteGeneralEntityIfExists(request, superadminToken, '/api/directory/tenants', tenantB);
    }
  });
});
