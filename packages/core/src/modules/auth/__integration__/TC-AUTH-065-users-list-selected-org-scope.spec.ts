import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-AUTH-065 [P1]: `GET /api/auth/users` honors the organization selected in the topbar for a
 * tenant-scoped (non-superadmin) administrator (#6803).
 *
 * Before the fix only superadmins with a selected tenant had the organization scope applied, so a
 * tenant admin switching between organizations kept seeing every user in the tenant.
 *
 * Covers: GET /api/auth/users (non-superadmin, `om_selected_org` cookie). Each fixture organization
 * is freshly created and holds exactly one user, so a single page fully covers its scope.
 */

type UserListResponse = { items?: Array<{ id?: unknown }> }

async function listUserIds(
  request: APIRequestContext,
  token: string,
  selectedOrgId: string,
): Promise<string[]> {
  const response = await apiRequestWithSelectedOrg(request, 'GET', '/api/auth/users?page=1&pageSize=100', {
    token,
    selectedOrgId,
  })
  expect(response.status(), 'GET /api/auth/users should return 200').toBe(200)
  const body = (await readJsonSafe<UserListResponse>(response)) ?? {}
  return (body.items ?? [])
    .map((item) => (typeof item.id === 'string' ? item.id : null))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

test.describe('TC-AUTH-065: users list follows the selected organization (#6803)', () => {
  test('a tenant admin sees only users of the selected organization', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId: homeOrganizationId, tenantId } = getTokenContext(adminToken)
    expectId(homeOrganizationId, 'admin token should carry a home organization')
    expectId(tenantId, 'admin token should carry a tenant')

    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    let firstOrganizationId: string | null = null
    let secondOrganizationId: string | null = null
    let firstUserId: string | null = null
    let secondUserId: string | null = null

    try {
      firstOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-AUTH-065 Org1 ${stamp}`,
        tenantId,
        parentId: homeOrganizationId,
      })
      secondOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-AUTH-065 Org2 ${stamp}`,
        tenantId,
        parentId: homeOrganizationId,
      })
      firstUserId = await createUserFixture(request, adminToken, {
        email: `qa-tc-auth-065-org1-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId: firstOrganizationId,
        roles: [],
      })
      secondUserId = await createUserFixture(request, adminToken, {
        email: `qa-tc-auth-065-org2-${stamp}@example.com`,
        password: 'StrongSecret123!',
        organizationId: secondOrganizationId,
        roles: [],
      })

      const firstOrgIds = await listUserIds(request, adminToken, firstOrganizationId)
      expect(firstOrgIds, 'Org1 selection should list the Org1 user').toContain(firstUserId)
      expect(firstOrgIds, 'Org1 selection must not list the Org2 user').not.toContain(secondUserId)

      const secondOrgIds = await listUserIds(request, adminToken, secondOrganizationId)
      expect(secondOrgIds, 'Org2 selection should list the Org2 user').toContain(secondUserId)
      expect(secondOrgIds, 'Org2 selection must not list the Org1 user').not.toContain(firstUserId)

      const lookupResponse = await apiRequestWithSelectedOrg(
        request,
        'GET',
        `/api/auth/users?ids=${encodeURIComponent(secondUserId)}`,
        { token: adminToken, selectedOrgId: firstOrganizationId },
      )
      expect(lookupResponse.status(), 'GET /api/auth/users?ids= should return 200').toBe(200)
      const lookupBody = (await readJsonSafe<UserListResponse>(lookupResponse)) ?? {}
      expect(
        (lookupBody.items ?? []).map((item) => item.id),
        'an explicit id lookup should still resolve a user outside the selected organization',
      ).toContain(secondUserId)
    } finally {
      await deleteUserIfExists(request, superadminToken, firstUserId)
      await deleteUserIfExists(request, superadminToken, secondUserId)
      await deleteOrganizationIfExists(request, superadminToken, firstOrganizationId)
      await deleteOrganizationIfExists(request, superadminToken, secondOrganizationId)
    }
  })
})
