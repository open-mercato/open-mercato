import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteGeneralEntityIfExists,
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'

type CreateResponse = { id?: string }

async function apiRequestWithCookie(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

function scopeCookie(tenantId: string, organizationId: string | null): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent(organizationId ?? '__all__')}`,
  ].join('; ')
}

async function createTenant(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/directory/tenants', { token, data: { name } })
  expect(response.status(), 'POST /api/directory/tenants should return 201').toBe(201)
  const body = await readJsonSafe<CreateResponse>(response)
  return expectId(body?.id, 'Tenant create response should contain an id')
}

async function createOrganization(
  request: APIRequestContext,
  token: string,
  cookie: string,
  tenantId: string,
  name: string,
): Promise<string> {
  const response = await apiRequestWithCookie(request, 'POST', '/api/directory/organizations', {
    token,
    cookie,
    data: { name, tenantId },
  })
  expect(response.status(), 'POST /api/directory/organizations should return 201').toBe(201)
  const body = await readJsonSafe<CreateResponse>(response)
  return expectId(body?.id, 'Organization create response should contain an id')
}

function createUser(request: APIRequestContext, token: string, organizationId: string, email: string) {
  return apiRequest(request, 'POST', '/api/auth/users', {
    token,
    data: { email, password: 'StrongSecret123!', organizationId },
  })
}

/**
 * TC-AUTH-047: User email uniqueness is scoped per-tenant, not globally (#2934).
 *
 * Before the fix the `users_email_unique` global constraint (and a globally-scoped
 * application duplicate check) let one tenant's email registration block any other tenant
 * from using the same address and leaked cross-tenant account existence. The same email must
 * now be usable across tenants, while remaining unique within a single tenant.
 *
 * Covers: POST /api/auth/users (create command duplicate-email handling + DB constraint).
 */
test.describe('TC-AUTH-047: Per-tenant user email uniqueness', () => {
  test('allows the same email in different tenants but rejects duplicates within a tenant', async ({ request }) => {
    const stamp = Date.now()
    const token = await getAuthToken(request, 'superadmin')
    const { tenantId: actorTenantId, organizationId: actorOrganizationId } = getTokenContext(token)
    const actorCookie = scopeCookie(actorTenantId, actorOrganizationId || null)
    const sharedEmail = `qa-auth-047-${stamp}@example.com`

    let tenantA: string | null = null
    let tenantB: string | null = null
    let organizationA: string | null = null
    let organizationB: string | null = null
    let userAId: string | null = null
    let userBId: string | null = null

    try {
      tenantA = await createTenant(request, token, `QA AUTH 047 Tenant A ${stamp}`)
      tenantB = await createTenant(request, token, `QA AUTH 047 Tenant B ${stamp}`)
      organizationA = await createOrganization(request, token, actorCookie, tenantA, `QA AUTH 047 Org A ${stamp}`)
      organizationB = await createOrganization(request, token, actorCookie, tenantB, `QA AUTH 047 Org B ${stamp}`)

      // 1) Create the user in tenant A.
      const firstResponse = await createUser(request, token, organizationA, sharedEmail)
      expect(firstResponse.status(), 'first user create in tenant A should succeed').toBe(201)
      userAId = expectId((await readJsonSafe<CreateResponse>(firstResponse))?.id, 'first user id')

      // 2) The SAME email in a DIFFERENT tenant must succeed (the #2934 fix). Before the fix
      //    this returned 400 (global app check) or 500 (global unique constraint).
      const crossTenantResponse = await createUser(request, token, organizationB, sharedEmail)
      expect(
        crossTenantResponse.status(),
        'same email in a separate tenant should succeed under per-tenant uniqueness',
      ).toBe(201)
      userBId = expectId((await readJsonSafe<CreateResponse>(crossTenantResponse))?.id, 'second user id')

      // 3) Reusing the email a second time WITHIN tenant A must still be rejected.
      const sameTenantDuplicate = await createUser(request, token, organizationA, sharedEmail)
      expect(
        sameTenantDuplicate.status(),
        'duplicate email within the same tenant should be rejected',
      ).toBe(400)
    } finally {
      await deleteGeneralEntityIfExists(request, token, '/api/auth/users', userAId)
      await deleteGeneralEntityIfExists(request, token, '/api/auth/users', userBId)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', organizationA)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/organizations', organizationB)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantA)
      await deleteGeneralEntityIfExists(request, token, '/api/directory/tenants', tenantB)
    }
  })
})
