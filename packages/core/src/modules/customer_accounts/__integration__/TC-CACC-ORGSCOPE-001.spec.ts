import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCustomerUserFixture,
  customerTestPassword,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CACC-ORGSCOPE-001 [P1]: `GET /api/customer_accounts/admin/users` honors the organization
 * switcher (#5574).
 *
 * The list used to pin its filter to the caller's home organization, so switching to another
 * organization or to "All organizations" returned the same users. It now resolves the request's
 * organization scope: a selected organization narrows the list to it, "All organizations" lists
 * every organization of the tenant.
 * Covers: GET /api/customer_accounts/admin/users, POST /api/customer_accounts/admin/users.
 */
type UserListResponse = { items?: Array<{ id?: string; organizationId?: string | null }> }

const BASE_URL = process.env.BASE_URL?.trim() || null

function resolveUrl(path: string): string {
  return BASE_URL ? `${BASE_URL}${path}` : path
}

function scopeCookie(tenantId: string, organizationId: string): string {
  return [
    `om_selected_tenant=${encodeURIComponent(tenantId)}`,
    `om_selected_org=${encodeURIComponent(organizationId)}`,
  ].join('; ')
}

async function scopedRequest(
  request: APIRequestContext,
  method: string,
  path: string,
  options: { token: string; cookie: string; data?: unknown },
) {
  return request.fetch(resolveUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      Cookie: options.cookie,
    },
    data: options.data,
  })
}

async function listCustomerUserIds(
  request: APIRequestContext,
  token: string,
  cookie: string,
): Promise<string[]> {
  const response = await scopedRequest(request, 'GET', '/api/customer_accounts/admin/users?pageSize=100', {
    token,
    cookie,
  })
  expect(response.status(), 'GET /api/customer_accounts/admin/users should return 200').toBe(200)
  const body = (await readJsonSafe<UserListResponse>(response)) ?? {}
  return (body.items ?? [])
    .map((item) => (typeof item.id === 'string' ? item.id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

test.describe('TC-CACC-ORGSCOPE-001: customer users list follows the organization switcher (#5574)', () => {
  test('lists only the selected organization, and every organization for "All organizations"', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId: homeOrgId, tenantId } = getTokenContext(adminToken)
    expectId(homeOrgId, 'admin token should carry a home organization')
    expectId(tenantId, 'admin token should carry a tenant')

    const suffix = uniqueSuffix()
    let otherOrgId: string | null = null
    let homeUserId: string | null = null
    let otherUserId: string | null = null

    try {
      otherOrgId = await createOrganizationFixture(request, adminToken, {
        name: `QA CACC ORGSCOPE ${suffix}`,
      })

      const homeUser = await createCustomerUserFixture(request, adminToken, {
        email: `qa-cacc-orgscope-home-${suffix}@test.local`,
      })
      homeUserId = homeUser.id

      const otherCreate = await scopedRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: superadminToken,
        cookie: scopeCookie(tenantId, otherOrgId),
        data: {
          email: `qa-cacc-orgscope-other-${suffix}@test.local`,
          password: customerTestPassword(),
          displayName: `QA CACC ORGSCOPE Other ${suffix}`,
        },
      })
      expect(otherCreate.status(), 'POST /admin/users in the other organization should return 201').toBe(201)
      const otherBody = await readJsonSafe<{ user?: { id?: string } }>(otherCreate)
      otherUserId = expectId(otherBody?.user?.id, 'User creation response should include user.id')

      const homeScopeIds = await listCustomerUserIds(request, adminToken, scopeCookie(tenantId, homeOrgId))
      expect(homeScopeIds, 'the home organization lists its own customer user').toContain(homeUserId)
      expect(homeScopeIds, 'the home organization must not list another organization user').not.toContain(otherUserId)

      const otherScopeIds = await listCustomerUserIds(request, adminToken, scopeCookie(tenantId, otherOrgId))
      expect(otherScopeIds, 'the selected organization lists its own customer user').toContain(otherUserId)
      expect(otherScopeIds, 'the selected organization must not list the home organization user').not.toContain(homeUserId)

      const allScopeIds = await listCustomerUserIds(request, adminToken, scopeCookie(tenantId, '__all__'))
      expect(allScopeIds, '"All organizations" lists the home organization user').toContain(homeUserId)
      expect(allScopeIds, '"All organizations" lists the other organization user').toContain(otherUserId)
    } finally {
      if (otherUserId && otherOrgId) {
        await scopedRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${otherUserId}`, {
          token: superadminToken,
          cookie: scopeCookie(tenantId, otherOrgId),
        }).catch(() => undefined)
      }
      if (homeUserId) {
        await scopedRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${homeUserId}`, {
          token: adminToken,
          cookie: scopeCookie(tenantId, homeOrgId),
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, adminToken, otherOrgId)
    }
  })
})
