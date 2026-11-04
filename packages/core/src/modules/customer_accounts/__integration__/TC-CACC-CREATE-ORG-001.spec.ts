import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCustomerRoleFixture,
  customerTestPassword,
  deleteCustomerRoleFixture,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CACC-CREATE-ORG-001 [P1]: an admin chooses the organization a new customer user is created in (#5576).
 *
 * `POST /api/customer_accounts/admin/users` used to place every user in the caller's active
 * organization. It now accepts an `organizationId`, honored only when the organization-scope
 * resolver grants it for the caller's tenant; roles are validated against the target
 * organization. The unit suites mock the resolver, so this spec exercises it for real.
 * Covers: POST /api/customer_accounts/admin/users, GET /api/customer_accounts/admin/roles.
 */
const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

async function deleteCustomerUserInOrganization(
  request: APIRequestContext,
  superadminToken: string,
  tenantId: string,
  organizationId: string,
  userId: string,
): Promise<void> {
  await request.fetch(resolveUrl(`/api/customer_accounts/admin/users/${userId}`), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${superadminToken}`,
      Cookie: `om_selected_tenant=${encodeURIComponent(tenantId)}; om_selected_org=${encodeURIComponent(organizationId)}`,
    },
  }).catch(() => undefined)
}

async function readCustomerUserOrganizationId(userId: string): Promise<string | null | undefined> {
  return withClient(async (client) => {
    const result = await client.query<{ organization_id: string | null }>(
      'select organization_id from customer_users where id = $1',
      [userId],
    )
    return result.rows[0]?.organization_id
  })
}

test.describe('TC-CACC-CREATE-ORG-001: create a customer user in a chosen organization (#5576)', () => {
  test('creates the user in the requested organization and rejects organizations outside the scope', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId: homeOrgId, tenantId } = getTokenContext(adminToken)
    expectId(homeOrgId, 'admin token should carry a home organization')
    expectId(tenantId, 'admin token should carry a tenant')

    const suffix = uniqueSuffix()
    let otherOrgId: string | null = null
    let homeRoleId: string | null = null
    let createdUserId: string | null = null

    try {
      otherOrgId = await createOrganizationFixture(request, adminToken, {
        name: `QA CACC CREATE ORG ${suffix}`,
      })
      homeRoleId = (await createCustomerRoleFixture(request, adminToken)).id

      const created = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: {
          email: `qa-cacc-create-org-${suffix}@test.local`,
          password: customerTestPassword(),
          displayName: `QA CACC Create Org ${suffix}`,
          organizationId: otherOrgId,
        },
      })
      expect(created.status(), 'POST /admin/users with an in-scope organizationId should return 201').toBe(201)
      const createdBody = await readJsonSafe<{ user?: { id?: string } }>(created)
      createdUserId = expectId(createdBody?.user?.id, 'User creation response should include user.id')
      expect(await readCustomerUserOrganizationId(createdUserId), 'the user is stored in the chosen organization').toBe(otherOrgId)

      const crossOrgRole = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: {
          email: `qa-cacc-create-org-role-${suffix}@test.local`,
          password: customerTestPassword(),
          displayName: `QA CACC Create Org Role ${suffix}`,
          organizationId: otherOrgId,
          roleIds: [homeRoleId],
        },
      })
      expect(crossOrgRole.status(), 'a role from another organization must be rejected for the target organization').toBe(400)

      const unknownOrg = await apiRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: adminToken,
        data: {
          email: `qa-cacc-create-org-unknown-${suffix}@test.local`,
          password: customerTestPassword(),
          displayName: `QA CACC Create Org Unknown ${suffix}`,
          organizationId: '00000000-0000-4000-8000-000000000000',
        },
      })
      expect(unknownOrg.status(), 'an organization that does not exist in the tenant must be rejected').toBe(400)

      const otherOrgRoles = await apiRequest(
        request,
        'GET',
        `/api/customer_accounts/admin/roles?pageSize=100&organizationId=${otherOrgId}`,
        { token: adminToken },
      )
      expect(otherOrgRoles.status(), 'GET /admin/roles for an in-scope organization should return 200').toBe(200)
      const otherOrgRoleIds = ((await readJsonSafe<{ items?: Array<{ id?: string }> }>(otherOrgRoles))?.items ?? [])
        .map((item) => item.id)
      expect(otherOrgRoleIds, 'roles of the home organization must not be listed for the other organization').not.toContain(homeRoleId)

      const homeRoles = await apiRequest(request, 'GET', '/api/customer_accounts/admin/roles?pageSize=100', { token: adminToken })
      const homeRoleIds = ((await readJsonSafe<{ items?: Array<{ id?: string }> }>(homeRoles))?.items ?? [])
        .map((item) => item.id)
      expect(homeRoleIds, 'the default role list stays the active organization').toContain(homeRoleId)

      const unknownOrgRoles = await apiRequest(
        request,
        'GET',
        '/api/customer_accounts/admin/roles?organizationId=00000000-0000-4000-8000-000000000000',
        { token: adminToken },
      )
      expect(unknownOrgRoles.status(), 'GET /admin/roles for an unknown organization should return 400').toBe(400)
    } finally {
      if (createdUserId && otherOrgId) {
        await deleteCustomerUserInOrganization(request, superadminToken, tenantId, otherOrgId, createdUserId)
      }
      await deleteCustomerRoleFixture(request, adminToken, homeRoleId)
      await deleteOrganizationIfExists(request, adminToken, otherOrgId)
    }
  })
})
