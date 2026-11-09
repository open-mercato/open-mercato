import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  deleteOrganizationIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  customerTestPassword,
  uniqueSuffix,
} from '@open-mercato/core/helpers/integration/customerAccountsFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-CACC-ORGSCOPE-002 [P1]: admin customer-user detail and actions follow the organization
 * switcher (#5577).
 *
 * After #5574 the users list honored the organization switcher, but the detail, update, delete and
 * action routes stayed pinned to the caller's home organization, so a user listed under another
 * selected organization (or under "All organizations") answered 404 when opened. Those routes now
 * resolve the same organization scope as the list; a user outside that scope still answers 404.
 * Covers: GET/PUT/DELETE /api/customer_accounts/admin/users/[id],
 * POST /api/customer_accounts/admin/users/[id]/verify-email.
 */
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

test.describe('TC-CACC-ORGSCOPE-002: customer user detail follows the organization switcher (#5577)', () => {
  test('opens and manages a user of another selected organization, hides it outside the scope', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId: homeOrgId, tenantId } = getTokenContext(adminToken)
    expectId(homeOrgId, 'admin token should carry a home organization')
    expectId(tenantId, 'admin token should carry a tenant')

    const suffix = uniqueSuffix()
    let otherOrgId: string | null = null
    let otherUserId: string | null = null
    let otherUserDeleted = false

    try {
      otherOrgId = await createOrganizationFixture(request, adminToken, {
        name: `QA CACC ORGSCOPE DETAIL ${suffix}`,
      })
      const otherScope = scopeCookie(tenantId, otherOrgId)

      const created = await scopedRequest(request, 'POST', '/api/customer_accounts/admin/users', {
        token: superadminToken,
        cookie: otherScope,
        data: {
          email: `qa-cacc-orgscope-detail-${suffix}@test.local`,
          password: customerTestPassword(),
          displayName: `QA CACC ORGSCOPE Detail ${suffix}`,
        },
      })
      expect(created.status(), 'POST /admin/users in the other organization should return 201').toBe(201)
      const createdBody = await readJsonSafe<{ user?: { id?: string } }>(created)
      otherUserId = expectId(createdBody?.user?.id, 'User creation response should include user.id')
      const detailPath = `/api/customer_accounts/admin/users/${otherUserId}`

      const selectedRead = await scopedRequest(request, 'GET', detailPath, { token: adminToken, cookie: otherScope })
      expect(selectedRead.status(), 'the selected organization opens its own customer user').toBe(200)
      const selectedBody = await readJsonSafe<{ id?: string; updatedAt?: string | null }>(selectedRead)
      expect(selectedBody?.id).toBe(otherUserId)

      const allRead = await scopedRequest(request, 'GET', detailPath, {
        token: adminToken,
        cookie: scopeCookie(tenantId, '__all__'),
      })
      expect(allRead.status(), '"All organizations" opens a user of any organization').toBe(200)

      const homeRead = await scopedRequest(request, 'GET', detailPath, {
        token: adminToken,
        cookie: scopeCookie(tenantId, homeOrgId),
      })
      expect(homeRead.status(), 'a user outside the selected organization stays hidden').toBe(404)

      const renamed = `QA CACC ORGSCOPE Renamed ${suffix}`
      const update = await scopedRequest(request, 'PUT', detailPath, {
        token: adminToken,
        cookie: otherScope,
        data: { displayName: renamed },
      })
      expect(update.status(), 'the selected organization updates its own customer user').toBe(200)

      const afterUpdate = await scopedRequest(request, 'GET', detailPath, { token: adminToken, cookie: otherScope })
      const afterUpdateBody = await readJsonSafe<{ displayName?: string }>(afterUpdate)
      expect(afterUpdateBody?.displayName).toBe(renamed)

      const verify = await scopedRequest(request, 'POST', `${detailPath}/verify-email`, {
        token: adminToken,
        cookie: otherScope,
      })
      expect(verify.status(), 'the selected organization verifies its own customer user email').toBe(200)

      const removal = await scopedRequest(request, 'DELETE', detailPath, { token: adminToken, cookie: otherScope })
      expect(removal.status(), 'the selected organization deletes its own customer user').toBe(200)
      otherUserDeleted = true
    } finally {
      if (otherUserId && otherOrgId && !otherUserDeleted) {
        await scopedRequest(request, 'DELETE', `/api/customer_accounts/admin/users/${otherUserId}`, {
          token: adminToken,
          cookie: scopeCookie(tenantId, otherOrgId),
        }).catch(() => undefined)
      }
      await deleteOrganizationIfExists(request, adminToken, otherOrgId)
    }
  })
})
