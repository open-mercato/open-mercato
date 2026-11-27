import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { ALL_ORGANIZATIONS_COOKIE_VALUE } from '@open-mercato/core/modules/directory/constants'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  apiRequestWithSelectedOrg,
  createOrganizationFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['search', 'auth', 'directory'],
}

test('TC-SEARCH-020: Search settings loads safely with a malformed organization cookie', async ({ request }) => {
  const administratorToken = await getAuthToken(request, 'superadmin')
  const tenantId = expectId(getTokenContext(administratorToken).tenantId, 'Tenant context is required')
  const fixtureId = randomUUID()
  const email = `qa-search-020-${fixtureId}@example.com`
  const password = `Test-${fixtureId}!`
  let organizationId: string | null = null
  let userId: string | null = null

  try {
    organizationId = await createOrganizationFixture(request, administratorToken, {
      name: `TC-SEARCH-020 ${fixtureId}`,
      tenantId,
    })
    userId = await createUserFixture(request, administratorToken, { email, password, organizationId, roles: [] })
    await setUserAclVisibility(request, administratorToken, {
      userId,
      organizations: [organizationId],
      features: ['search.view', 'search.embeddings.view'],
    })
    const token = await getAuthToken(request, email, password)

    for (const path of ['/api/search/settings', '/api/search/embeddings']) {
      const unselected = await apiRequest(request, 'GET', path, { token })
      expect(unselected.status()).toBe(200)
      const settings = await readJsonSafe(unselected)
      expect(settings).toMatchObject({ settings: expect.any(Object) })

      for (const selectedOrgId of ['all', organizationId, ALL_ORGANIZATIONS_COOKIE_VALUE]) {
        const response = await apiRequestWithSelectedOrg(request, 'GET', path, { token, selectedOrgId })
        expect(response.status(), `${path}, selection ${selectedOrgId}`).toBe(200)
        expect(await readJsonSafe(response)).toMatchObject({ settings: expect.any(Object) })
      }
    }
  } finally {
    await deleteUserIfExists(request, administratorToken, userId)
    await deleteOrganizationIfExists(request, administratorToken, organizationId)
  }
})
