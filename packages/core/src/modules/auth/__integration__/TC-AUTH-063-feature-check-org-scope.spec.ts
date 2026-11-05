import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const GRANTED_FEATURE = 'auth.users.list'

type FeatureCheckResponse = {
  ok?: boolean
  granted?: string[]
}

test.describe('TC-AUTH-063: feature-check uses the request-selected organization', () => {
  test('agrees with route guards for a non-home organization ACL', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { organizationId: homeOrganizationId, tenantId } = getTokenContext(superadminToken)
    const stamp = `${Date.now()}-${randomInt(1_000_000)}`
    const email = `qa-tc-auth-063-${stamp}@example.com`
    const password = 'StrongSecret123!'
    let selectedOrganizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      selectedOrganizationId = await createOrganizationFixture(request, superadminToken, {
        name: `QA TC-AUTH-063 ${stamp}`,
        tenantId,
      })
      roleId = await createRoleFixture(request, superadminToken, { name: `qa-tc-auth-063-${stamp}` })
      userId = await createUserFixture(request, superadminToken, {
        email,
        password,
        organizationId: homeOrganizationId,
        roles: [roleId],
        name: 'QA TC-AUTH-063',
      })
      await setUserAclVisibility(request, superadminToken, {
        userId,
        organizations: [selectedOrganizationId],
        features: [GRANTED_FEATURE],
      })
      const userToken = await getAuthToken(request, email, password)

      const selectedResponse = await apiRequestWithSelectedOrg(request, 'POST', '/api/auth/feature-check', {
        token: userToken,
        selectedOrgId: selectedOrganizationId,
        data: { features: [GRANTED_FEATURE] },
      })
      const selectedCheck = await readJsonSafe<FeatureCheckResponse>(selectedResponse)
      expect(selectedResponse.status(), 'feature-check should return 200 in the selected scope').toBe(200)
      expect(selectedCheck?.ok, 'feature-check should grant the selected-organization feature').toBe(true)
      expect(selectedCheck?.granted ?? []).toContain(GRANTED_FEATURE)

      const guardedRoute = await apiRequestWithSelectedOrg(request, 'GET', '/api/auth/users?pageSize=1', {
        token: userToken,
        selectedOrgId: selectedOrganizationId,
      })
      expect(guardedRoute.status(), 'the route guard should grant the same selected-organization feature').toBe(200)
    } finally {
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, selectedOrganizationId)
    }
  })
})
